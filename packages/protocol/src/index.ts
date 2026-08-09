/** Versioned wire-contract shared by every SPM component. */
export const PROTOCOL_VERSION = 1 as const;
export const MAX_MESSAGE_BYTES = 16 * 1024;
export const USERNAME = /^[a-z][a-z0-9_]{2,31}$/;

export type Bytes = Uint8Array;
export type RequestPurpose = "private-http" | "socket-connect" | "socket-send";

export interface SignedRequest {
  version: 1;
  purpose: RequestPurpose;
  method: string;
  route: string;
  payloadHash: Bytes;
  expiresAt: number;
  installationId: string;
  requestId: string;
}

export interface PublicPrekeyBundle {
  username: string;
  identitySigningPublicKey: Bytes;
  identityDhPublicKey: Bytes;
  signedPrekey: Bytes;
  signedPrekeyId: number;
  signedPrekeySignature: Bytes;
  oneTimePrekey?: Bytes;
  oneTimePrekeyId?: number;
  keyVersion: number;
}

/** Opaque bytes from a vetted Signal/X3DH implementation. Never plaintext. */
export interface DirectEnvelope {
  version: 1;
  idempotencyId: string;
  recipient: string;
  recipientKeyVersion: number;
  prekeyMessage: boolean;
  ciphertext: Bytes;
  sentAt: number;
}

export const ErrorCode = {
  INVALID_USERNAME: "INVALID_USERNAME",
  CHALLENGE_EXPIRED: "CHALLENGE_EXPIRED",
  CHALLENGE_USED: "CHALLENGE_USED",
  INVALID_SIGNATURE: "INVALID_SIGNATURE",
  INSTALLATION_REPLACED: "INSTALLATION_REPLACED",
  PREKEY_UNAVAILABLE: "PREKEY_UNAVAILABLE",
  ENVELOPE_INVALID: "ENVELOPE_INVALID"
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export function normalizeUsername(input: string): string {
  const username = input.normalize("NFKC").toLowerCase();
  if (!USERNAME.test(username)) throw new ProtocolError(ErrorCode.INVALID_USERNAME, "Username must be 3–32 lowercase handle characters.");
  return username;
}

export class ProtocolError extends Error {
  constructor(public readonly code: ErrorCode, message: string) { super(message); }
}

/** Canonical CBOR is required for signatures. This supports the protocol's bounded primitives. */
export function canonicalCbor(value: unknown): Bytes {
  const out: number[] = [];
  const pushHead = (major: number, n: number): void => {
    if (!Number.isSafeInteger(n) || n < 0) throw new TypeError("CBOR integer out of range");
    if (n < 24) out.push((major << 5) | n);
    else if (n <= 0xff) out.push((major << 5) | 24, n);
    else if (n <= 0xffff) out.push((major << 5) | 25, n >> 8, n & 255);
    else if (n <= 0xffff_ffff) {
      out.push((major << 5) | 26, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
    } else {
      const value = BigInt(n);
      out.push((major << 5) | 27);
      for (let shift = 56n; shift >= 0n; shift -= 8n) out.push(Number((value >> shift) & 0xffn));
    }
  };
  const enc = new TextEncoder();
  const write = (v: unknown): void => {
    if (v instanceof Uint8Array) { pushHead(2, v.length); out.push(...v); return; }
    if (typeof v === "string") { const b = enc.encode(v); pushHead(3, b.length); out.push(...b); return; }
    if (typeof v === "number" && Number.isInteger(v) && v >= 0) { pushHead(0, v); return; }
    if (typeof v === "boolean") { out.push(v ? 0xf5 : 0xf4); return; }
    if (v === null) { out.push(0xf6); return; }
    if (Array.isArray(v)) { pushHead(4, v.length); v.forEach(write); return; }
    if (typeof v === "object" && v) {
      const compareBytes = (a: Uint8Array, b: Uint8Array): number => {
        if (a.length !== b.length) return a.length - b.length;
        for (let i = 0; i < a.length; i += 1) {
          const difference = a[i]! - b[i]!;
          if (difference) return difference;
        }
        return 0;
      };
      const entries = Object.entries(v as Record<string, unknown>).map(([k, x]) => [enc.encode(k), k, x] as const)
        .sort((a, b) => compareBytes(a[0], b[0]));
      pushHead(5, entries.length); for (const [, k, x] of entries) { write(k); write(x); } return;
    }
    throw new TypeError("Unsupported canonical CBOR value");
  };
  write(value); return Uint8Array.from(out);
}

export function signingBytes(request: SignedRequest): Bytes { return canonicalCbor(request); }
export function envelopeBytes(envelope: DirectEnvelope): Bytes { return canonicalCbor(envelope); }

import {
  canonicalCbor,
  signingBytes,
  type DirectEnvelope,
  type PublicPrekeyBundle,
  type RequestPurpose,
  type SignedRequest,
} from "@spm/protocol";

const encoder = new TextEncoder();
const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

export interface RequestSigner {
  sign(input: Uint8Array): Promise<Uint8Array>;
}
export interface ClientIdentity {
  username: string;
  installationId: string;
  signer: RequestSigner;
}
export interface Challenge {
  id: string;
  expiresAt: number;
}

/** Signed REST adapter. It has no token support and never serialises a private key. */
export class SignedRestClient {
  constructor(
    private readonly baseUrl: string,
    private readonly identity: ClientIdentity,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!/^https:\/\//.test(baseUrl))
      throw new Error("SPM API must use HTTPS.");
  }
  private async hash(value: unknown): Promise<Uint8Array> {
    // An absent body has one unambiguous signed representation.
    const input = canonicalCbor(value === undefined ? null : value);
    return new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(input)),
    );
  }
  private async signed(
    method: string,
    route: string,
    payload: unknown,
    purpose: RequestPurpose = "private-http",
  ): Promise<Headers> {
    const challengeResponse = await this.fetcher(
      `${this.baseUrl}/v1/challenges`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: this.identity.username,
          purpose,
          route,
        }),
      },
    );
    if (!challengeResponse.ok)
      throw new Error("Could not obtain a signing challenge.");
    const challenge = (await challengeResponse.json()) as Challenge;
    const request: SignedRequest = {
      version: 1,
      purpose,
      method,
      route,
      payloadHash: await this.hash(payload),
      expiresAt: challenge.expiresAt,
      installationId: this.identity.installationId,
      requestId: challenge.id,
    };
    const signature = await this.identity.signer.sign(signingBytes(request));
    return new Headers({
      "content-type": "application/json",
      "x-spm-username": this.identity.username,
      "x-spm-proof": b64(canonicalCbor(request)),
      "x-spm-signature": b64(signature),
    });
  }
  async request<T>(
    method: string,
    route: string,
    payload: unknown,
  ): Promise<T> {
    const headers = await this.signed(method, route, payload);
    const response = await this.fetcher(`${this.baseUrl}${route}`, {
      method,
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    if (!response.ok)
      throw new Error(`SPM request failed (${response.status}).`);
    return response.json() as Promise<T>;
  }
  lookup(username: string): Promise<PublicPrekeyBundle> {
    return this.request(
      "GET",
      `/v1/directory/${encodeURIComponent(username)}`,
      undefined,
    );
  }
  send(
    envelope: DirectEnvelope,
  ): Promise<{ messageId: string; duplicate: boolean }> {
    return this.request("POST", "/v1/messages", envelope);
  }
}

/** Transport-neutral signed WebSocket protocol boundary; wire it to Socket.IO only at integration. */
export interface SignedSocket {
  connect(): Promise<void>;
  send(envelope: DirectEnvelope): Promise<void>;
  close(): void;
}

export class ReleaseGatedSignedSocket implements SignedSocket {
  constructor(readonly url: string) {
    if (!/^wss:\/\//.test(url))
      throw new Error("SPM realtime endpoint must use WSS.");
  }
  async connect(): Promise<void> {
    throw new Error(
      "Socket transport requires the server Socket.IO integration.",
    );
  }
  async send(): Promise<void> {
    throw new Error(
      "Socket transport requires the server Socket.IO integration.",
    );
  }
  close(): void {
    /* no connection was created */
  }
}

/** Native Ed25519 signing adapter; callers retain the CryptoKey exclusively in memory. */
export const webCryptoSigner = (privateKey: CryptoKey): RequestSigner => ({
  sign: async (input) =>
    new Uint8Array(
      await crypto.subtle.sign("Ed25519", privateKey, new Uint8Array(input)),
    ),
});

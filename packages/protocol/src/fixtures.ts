import type { DirectEnvelope, PublicPrekeyBundle, SignedRequest } from "./index.js";

/** Deterministic non-secret fixtures for adapter conformance tests. */
export const protocolFixtures: Readonly<{
  signedRequest: SignedRequest;
  bundle: PublicPrekeyBundle;
  envelope: DirectEnvelope;
}> = {
  signedRequest: {
    version: 1,
    purpose: "private-http",
    method: "POST",
    route: "/v1/messages",
    payloadHash: new Uint8Array(32).fill(1),
    expiresAt: 2_000_000_000_000,
    installationId: "00000000-0000-7000-8000-000000000001",
    requestId: "00000000-0000-7000-8000-000000000002"
  },
  bundle: {
    username: "alice",
    identitySigningPublicKey: new Uint8Array(32).fill(2),
    identityDhPublicKey: new Uint8Array(32).fill(3),
    signedPrekey: new Uint8Array(32).fill(4),
    signedPrekeyId: 1,
    signedPrekeySignature: new Uint8Array(64).fill(5),
    oneTimePrekey: new Uint8Array(32).fill(6),
    oneTimePrekeyId: 2,
    keyVersion: 1
  },
  envelope: {
    version: 1,
    idempotencyId: "00000000-0000-7000-8000-000000000003",
    recipient: "bob",
    recipientKeyVersion: 1,
    prekeyMessage: true,
    ciphertext: new Uint8Array([7, 8, 9]),
    sentAt: 1_700_000_000_000
  }
};

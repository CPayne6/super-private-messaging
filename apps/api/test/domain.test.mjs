import assert from "node:assert/strict";
import test from "node:test";
import { ErrorCode, ProtocolError } from "@spm/protocol";
import { MessagingService, RequestAuthenticator } from "../dist/domain.js";

const username = "alice";
const installationId = "018f8b1e-5e50-7000-8000-000000000001";
const requestId = "018f8b1e-5e50-7000-8000-000000000002";
const payloadHash = new Uint8Array(32).fill(7);

test("request authentication binds the route and consumes a challenge once", async () => {
  let consumed = false;
  const auth = new RequestAuthenticator(
    { consume: async () => { if (consumed) return false; consumed = true; return true; } },
    { verify: async () => true, verifyPublicKey: async () => true },
    () => 100
  );
  const challenge = { id: requestId, username, purpose: "private-http", method: "POST", route: "/v1/messages", expiresAt: 200 };
  const proof = { request: { version: 1, purpose: "private-http", method: "POST", route: "/v1/messages", payloadHash, expiresAt: 200, installationId, requestId }, signature: new Uint8Array(64) };
  assert.equal((await auth.authenticate(challenge, proof, payloadHash)).username, username);
  await assert.rejects(() => auth.authenticate(challenge, proof, payloadHash), (error) => error instanceof ProtocolError && error.code === ErrorCode.CHALLENGE_USED);
});

test("send rejects a stale installation before ciphertext persistence", async () => {
  let appended = false;
  const service = new MessagingService(
    { isActiveInstallation: async () => false, findBundle: async () => undefined },
    { append: async () => { appended = true; return { messageId: requestId, duplicate: false }; }, listFor: async () => ({ envelopes: [] }), deleteFor: async () => {} }
  );
  const envelope = { version: 1, idempotencyId: requestId, recipient: "bob", recipientKeyVersion: 1, prekeyMessage: true, ciphertext: new Uint8Array([1]), sentAt: 1 };
  await assert.rejects(() => service.send({ username, installationId, requestId }, envelope), (error) => error instanceof ProtocolError && error.code === ErrorCode.INSTALLATION_REPLACED);
  assert.equal(appended, false);
});

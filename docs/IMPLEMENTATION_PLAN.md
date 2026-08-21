# Secure Public Messaging App — Implementation Plan

## Summary

Build a pnpm monorepo with a React/Ant Design/Tailwind web client, NestJS API, PostgreSQL persistence, and Redis-backed WebSocket presence. Use Signal-style X3DH prekeys and Double Ratchet sessions for 1:1 text messages, based on the [X3DH](https://signal.org/docs/specifications/x3dh/) and [Double Ratchet](https://signal.org/docs/specifications/doubleratchet/) specifications.

Private keys never leave the browser. The encrypted key vault is downloaded locally and transferred between devices only through user-controlled offline media. "Private-key encryption" for identity verification is implemented correctly as an Ed25519 digital signature verified by the corresponding public key.

## Core implementation

- Establish `apps/web`, `apps/api`, and a shared versioned protocol package before feature work. The protocol package owns canonical CBOR schemas, byte encodings, API/event names, error codes, signed-request inputs, and test fixtures.

- Generate an identity bundle entirely in the browser:
  - Ed25519 signing keys for registration, request proofs, WebSocket authentication, and signed key rotation.
  - X25519/Signal session keys, signed prekeys, one-time prekeys, ratchet state, and encrypted local history.
  - Persist and export a versioned `.spmkey` vault: canonical CBOR encrypted with Argon2id-derived keys and XChaCha20-Poly1305.
  - On first registration, require the browser to download the encrypted vault locally and require user acknowledgement before sending the public registration bundle.
  - Store only the encrypted vault in IndexedDB; never store raw secret bytes in localStorage. Require the vault passphrase after a browser restart, decrypt only in memory, and clear memory/cache/IndexedDB through the settings screen.
  - Import uses local drag/drop parsing only—no upload endpoint, multipart request, or socket event. Users transfer vault files to another device only with offline media or direct offline cable transfer.

- Implement public identity registration and directory:
  - Usernames are normalized lowercase handles, unique and permanently bound to the initial identity unless the current key signs a rotation.
  - Store only public identity/signing keys, active signed prekeys, one-time prekeys, fingerprints, and key-version metadata in PostgreSQL.
  - Expose public lookup by username for messaging. The v1 threat model trusts this directory, so key transparency and safety-number verification are excluded.

- Authenticate every private HTTP action with a short-lived, single-use server challenge and an Ed25519 signature over canonical CBOR containing purpose, route/method, payload hash, expiry, installation ID, and request ID.
  - WebSocket connection authentication uses the same signed challenge before assigning a username or publishing presence.
  - A successful authentication activates that browser installation and invalidates the prior active installation for the identity, preventing concurrent copied-vault ratchet use.
  - Each WebSocket message-send event includes a signature bound to its exact encrypted envelope.
  - No bearer session token or private key is transmitted.

- Encrypt direct messages in the browser using the recipient’s published prekey bundle, then persist and relay only opaque Signal envelopes. Do not hand-write cryptographic primitives or ratcheting logic.
  - A browser-compatible, independently vetted Signal implementation/WASM binding is a release gate; the official `libsignal` project does not support outside use, so no unreviewed adaptation is acceptable. [Official project note](https://github.com/signalapp/libsignal)
  - V1 supports text-only 1:1 conversations, one active device/vault per username, durable encrypted history, and no copied-vault concurrent use.
  - Before a restored vault can send, it processes pending messages and persists updated ratchet state. Device moves require a fresh export from the old device.
  - Delete conversation removes the caller’s local cache and ciphertext addressed to them; it cannot erase the other participant’s local history.

- Use scalable PostgreSQL entities for users, devices/identity bundles, signed and one-time prekeys, consumed challenges, direct conversations, append-only UUIDv7 messages, recipient envelopes, delivery state, and per-user deletion markers. Store ciphertext and protocol bytes as `bytea`; use idempotency IDs, cursor pagination, recipient/key indexes, and time partitioning for envelope growth.

- Implement Redis-backed presence and Socket.IO scaling:
  - Track authenticated username connection counts and heartbeat TTLs only in Redis.
  - Broadcast username-only online-list deltas after authentication; display the board in the messaging screen.
  - Persist a message before real-time fan-out; Redis is never the message source of truth.

- Build three minimal, responsive, accessible screens:
  1. **Key access** — generate username/vault, passphrase confirmation, mandatory local backup download, local drag/drop import, and unlock existing vault.
  2. **Messages** — encrypted history, username recipient lookup, compose/send, delivery states, and online-user board.
  3. **Key & account settings** — download a current vault before a device move, lock, signed key rotation, key fingerprints, and destructive local-data removal confirmation.

- Apply strict browser/API hardening: HTTPS/WSS-only configuration, restrictive CSP and Trusted Types, no analytics or third-party runtime scripts, secure headers, origin-restricted CORS, rate limits, payload limits, redacted logs, dependency pinning/audits, and no sensitive telemetry.

## Parallel work plan

1. **Foundation owner, first:** create workspace structure and freeze the shared protocol package, protocol test vectors, database contract, vault-file specification, and security document.
2. **Backend owner:** implement PostgreSQL migrations, identity directory, challenge/signature verification, active-installation control, prekey lifecycle, message persistence, deletion behavior, and private REST endpoints.
3. **Realtime owner:** implement only the gateway/presence subtree, Redis adapter, signed socket authentication, installation invalidation, presence events, and post-commit fan-out port.
4. **Frontend owner:** implement the React app, local vault/crypto adapter, browser-only Blob export/File API import, offline-transfer guidance, Ant Design/Tailwind screens, signed REST/WebSocket client, and local decryption/history cache.
5. **Integration/security owner:** wire frozen interfaces, run protocol vectors and end-to-end tests, add hardening, dependency checks, accessibility checks, and a release-blocking external cryptography review.

## Test plan

- Protocol vectors for X3DH/ratchet behavior, tamper rejection, out-of-order delivery, replay rejection, prekey exhaustion/refill, key rotation, stale-vault warnings, and active-installation switching.
- Vault tests for wrong passphrase, altered ciphertext, browser-only export/import, no private-byte network transmission, and verified clearing of local state.
- Browser tests confirming import makes no HTTP/WebSocket request before a successful local unlock, and that the app exposes no vault-file upload API.
- API/database tests for username races, challenge reuse/expiry, invalid signatures, idempotent sends, pagination, deletion scope, and absence of plaintext in persistence/logs.
- WebSocket tests for signed connection/authentication, multi-tab presence counts, disconnect grace, prior-installation invalidation, unauthorized events, and post-commit fan-out.
- Playwright tests proving only the intended recipient decrypts a message, an offline-transferred vault restores a browser session, screens remain keyboard-accessible, and the online board updates correctly.

## Assumptions

- The `.spmkey` vault is moved between devices only through offline storage or an offline direct cable transfer; cloud drives, email, and any other network transfer are prohibited.
- Lost keys have no recovery path; the username and prior messages cannot be reclaimed without the existing vault.
- A temporarily compromised unlocked device can still be impersonated until signed key rotation; ratcheting protects prior messages and can recover future secrecy after new exchanges.
- The service is trusted not to substitute public directory keys; metadata, timing, IP addresses, recipient relationships, ciphertext size, and public online presence remain visible to the service.
- Attachments, groups, plaintext search, notifications containing message content, multi-device synchronization, post-quantum ratcheting, and production hosting implementation are out of v1 scope. A future deployment should use cloud-native containers, managed PostgreSQL/Redis, and static web hosting.

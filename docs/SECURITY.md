# SPM v1 security contract

## Non-negotiable boundaries

- The browser generates, unlocks, and uses private key bytes. The API accepts only public registration material, opaque protocol envelopes, request signatures, and public metadata.
- A `.spmkey` vault is encoded canonically, encrypted locally with Argon2id-derived keys and XChaCha20-Poly1305, and is transferred only through offline media or cable. There is no vault upload endpoint, multipart parser, or socket event.
- Browser private material is encrypted in IndexedDB only. It is never stored in localStorage; unlocking requires the passphrase after a restart. Lock and local-data removal clear in-memory state and IndexedDB.
- “Encrypting with a private key” means an Ed25519 signature. Server request proof and socket proof bind the purpose, route/method, payload hash, expiry, installation ID, and single-use request ID in canonical CBOR.
- Signal X3DH/Double Ratchet is a release-gated adapter. No release may substitute custom cryptography for a vetted browser-compatible implementation and independent review.

## Known metadata and v1 limits

The service can see IP addresses, timing, account relationships, public online presence, ciphertext sizes, and recipient usernames. It cannot recover lost vaults. v1 excludes groups, attachments, multi-device sync, plaintext search, content notifications, key transparency, and post-quantum ratcheting.

## Deployment controls

Serve only HTTPS/WSS. Restrict CORS to the configured web origin; set a nonce-based CSP with `default-src 'none'`, no third-party scripts or analytics, and Trusted Types. Apply payload limits, origin checks, rate limits, log redaction, dependency audit/pinning, and partition the growing recipient-envelope table by time before production scale.

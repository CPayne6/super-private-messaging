# `.spmkey` format v1

The file is a canonical-CBOR map with `version: 1`, `kdf: "argon2id"`, KDF parameters and salt, a 24-byte XChaCha20-Poly1305 nonce, and authenticated ciphertext. The plaintext is another canonical-CBOR map containing the public identity, Ed25519 signing secret, X25519/session state, signed and one-time prekeys, ratchet state, and encrypted local-history key.

Vault files are parsed locally through the File API. The implementation must reject unknown required versions, malformed canonical CBOR, oversized inputs, incorrect passphrases, and failed authentication tags. Export uses a browser Blob download; import must not make HTTP or WebSocket traffic before successful local unlock.

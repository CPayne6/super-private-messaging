/**
 * Browser interoperability boundary for X25519.
 *
 * The protocol stores the compact 32-byte RFC 7748 public-key form. Web Crypto
 * accepts that form, but importing the equivalent RFC 8410 SPKI form is more
 * reliable in Firefox releases that had X25519 raw/JWK interoperability bugs.
 */
const X25519_PUBLIC_KEY_BYTES = 32;
const X25519_SPKI_PREFIX = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x03, 0x21, 0x00,
]);

const copy = (value: Uint8Array): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(value);

export function x25519Spki(publicKey: Uint8Array): Uint8Array {
  if (publicKey.byteLength !== X25519_PUBLIC_KEY_BYTES)
    throw new Error("Invalid X25519 public key.");
  const result = new Uint8Array(
    X25519_SPKI_PREFIX.byteLength + X25519_PUBLIC_KEY_BYTES,
  );
  result.set(X25519_SPKI_PREFIX);
  result.set(publicKey, X25519_SPKI_PREFIX.byteLength);
  return result;
}

export async function importX25519PublicKey(
  publicKey: Uint8Array,
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    copy(x25519Spki(publicKey)),
    { name: "X25519" },
    false,
    [],
  );
}

export async function deriveX25519(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
): Promise<Uint8Array> {
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "X25519", public: publicKey },
    privateKey,
    256,
  );
  return new Uint8Array(sharedSecret);
}

/** Confirm that this browser can perform the exact X25519 flow used by chats. */
export async function verifyX25519KeyAgreement(
  keyPair: CryptoKeyPair,
): Promise<void> {
  const peer = (await crypto.subtle.generateKey(
    { name: "X25519" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const peerPublicKey = new Uint8Array(
    await crypto.subtle.exportKey("raw", peer.publicKey),
  );
  const secret = await deriveX25519(
    keyPair.privateKey,
    await importX25519PublicKey(peerPublicKey),
  );
  if (secret.byteLength !== X25519_PUBLIC_KEY_BYTES)
    throw new Error("The browser returned an invalid X25519 shared secret.");
}

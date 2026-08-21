import { normalizeUsername } from "@spm/protocol";
import { debug, debugError } from "./debug.js";
import type { VaultContents } from "./vault.js";
import { verifyX25519KeyAgreement } from "./x25519.js";

const bytes = (value: ArrayBuffer): Uint8Array => new Uint8Array(value);
const randomId = (): string => crypto.randomUUID();

function cryptoSupportError(algorithm: "Ed25519" | "X25519"): Error {
  const isFirefox = /firefox/i.test(navigator.userAgent);
  if (isFirefox && algorithm === "X25519") {
    return new Error(
      "This Firefox version cannot create the X25519 keys required by the app. Update Firefox to version 130 or later, then reload this page.",
    );
  }
  return new Error(
    `This browser cannot create ${algorithm} keys required by the app. Use a current version of Firefox (130 or later) or Chrome.`,
  );
}

async function generateKeyPair(
  algorithm: "Ed25519" | "X25519",
  usages: KeyUsage[],
): Promise<CryptoKeyPair> {
  try {
    return (await crypto.subtle.generateKey(
      { name: algorithm },
      true,
      usages,
    )) as CryptoKeyPair;
  } catch {
    throw cryptoSupportError(algorithm);
  }
}

/** Browser-native key generation; private bytes are returned for immediate vault encryption only. */
export async function generateVaultContents(
  usernameInput: string,
): Promise<VaultContents> {
  const username = normalizeUsername(usernameInput);
  debug("identity.create.start");
  if (!globalThis.crypto?.subtle)
    throw new Error("This browser does not support Web Crypto.");
  if (!globalThis.isSecureContext)
    throw new Error(
      "Open the app through https:// or localhost. Browsers only expose the required cryptography on secure pages.",
    );

  const [s, d, p, o] = await Promise.all([
    generateKeyPair("Ed25519", ["sign", "verify"]),
    generateKeyPair("X25519", ["deriveBits"]),
    generateKeyPair("X25519", ["deriveBits"]),
    generateKeyPair("X25519", ["deriveBits"]),
  ]);
  try {
    await verifyX25519KeyAgreement(d);
    debug("identity.create.x25519-ready");
  } catch (error) {
    debugError("identity.create.x25519-failed", error);
    throw cryptoSupportError("X25519");
  }
  return {
    version: 1,
    username,
    installationId: randomId(),
    identitySigningPublicKey: bytes(
      await crypto.subtle.exportKey("raw", s.publicKey),
    ),
    identitySigningPrivateKey: bytes(
      await crypto.subtle.exportKey("pkcs8", s.privateKey),
    ),
    identityDhPublicKey: bytes(
      await crypto.subtle.exportKey("raw", d.publicKey),
    ),
    identityDhPrivateKey: bytes(
      await crypto.subtle.exportKey("pkcs8", d.privateKey),
    ),
    signedPrekeyPrivateKey: bytes(
      await crypto.subtle.exportKey("pkcs8", p.privateKey),
    ),
    oneTimePrekeyPrivateKeys: [
      bytes(await crypto.subtle.exportKey("pkcs8", o.privateKey)),
    ],
    ratchetState: new Uint8Array(),
    historyKey: crypto.getRandomValues(new Uint8Array(32)),
  };
}

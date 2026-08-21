import { canonicalCbor } from "@spm/protocol";
const browserBytes = (value: Uint8Array): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(value);

/** Browser-only vault boundary. No function here performs a network request. */
export const VAULT_MIME = "application/vnd.spm.key+cbor";
export interface EncryptedVault {
  version: 1;
  kdf: "pbkdf2-sha256";
  salt: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}
export interface VaultCrypto {
  encrypt(plaintext: Uint8Array, passphrase: string): Promise<EncryptedVault>;
  decrypt(vault: EncryptedVault, passphrase: string): Promise<Uint8Array>;
}

/** The secret payload held only while the vault is unlocked. */
export interface VaultContents {
  version: 1;
  username: string;
  installationId: string;
  identitySigningPublicKey: Uint8Array;
  identitySigningPrivateKey: Uint8Array;
  identityDhPublicKey: Uint8Array;
  identityDhPrivateKey: Uint8Array;
  signedPrekeyPrivateKey: Uint8Array;
  oneTimePrekeyPrivateKeys: readonly Uint8Array[];
  ratchetState: Uint8Array;
  historyKey: Uint8Array;
}

export function encodeVaultContents(contents: VaultContents): Uint8Array {
  return canonicalCbor({
    ...contents,
    oneTimePrekeyPrivateKeys: [...contents.oneTimePrekeyPrivateKeys],
  });
}

/** Serialise only encrypted vault records.  This deliberately has no upload API. */
export function encodeEncryptedVault(vault: EncryptedVault): Uint8Array {
  if (
    vault.salt.byteLength < 16 ||
    vault.nonce.byteLength !== 12 ||
    !vault.ciphertext.byteLength
  )
    throw new Error("Invalid encrypted vault.");
  return canonicalCbor({
    version: vault.version,
    kdf: vault.kdf,
    salt: vault.salt,
    nonce: vault.nonce,
    ciphertext: vault.ciphertext,
  });
}

/** A deliberately small CBOR reader for the bounded vault envelope format. */
function decodeCbor(bytes: Uint8Array): unknown {
  let offset = 0;
  const readLength = (additional: number): number => {
    if (additional < 24) return additional;
    const count =
      additional === 24 ? 1 : additional === 25 ? 2 : additional === 26 ? 4 : 0;
    if (!count || offset + count > bytes.length)
      throw new Error("Malformed vault CBOR.");
    let value = 0;
    for (let i = 0; i < count; i += 1) value = value * 256 + bytes[offset + i]!;
    offset += count;
    return value;
  };
  const read = (): unknown => {
    if (offset >= bytes.length) throw new Error("Malformed vault CBOR.");
    const head = bytes[offset++]!,
      major = head >> 5,
      additional = head & 31,
      length = readLength(additional);
    if (major === 0) return length;
    if (major === 2) {
      if (offset + length > bytes.length)
        throw new Error("Malformed vault CBOR.");
      const value = bytes.slice(offset, offset + length);
      offset += length;
      return value;
    }
    if (major === 3) {
      if (offset + length > bytes.length)
        throw new Error("Malformed vault CBOR.");
      const value = new TextDecoder().decode(
        bytes.slice(offset, offset + length),
      );
      offset += length;
      return value;
    }
    if (major === 4) {
      const values: unknown[] = [];
      for (let i = 0; i < length; i += 1) values.push(read());
      return values;
    }
    if (major === 5) {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < length; i += 1) {
        const key = read();
        if (typeof key !== "string" || key in obj)
          throw new Error("Malformed vault CBOR.");
        obj[key] = read();
      }
      return obj;
    }
    throw new Error("Unsupported vault CBOR value.");
  };
  const result = read();
  if (offset !== bytes.length) throw new Error("Trailing vault data.");
  return result;
}

export function decodeEncryptedVault(bytes: Uint8Array): EncryptedVault {
  if (bytes.byteLength > 5 * 1024 * 1024)
    throw new Error("Vault file is too large.");
  const value = decodeCbor(bytes);
  if (!value || typeof value !== "object") throw new Error("Malformed vault.");
  const v = value as Record<string, unknown>;
  if (
    v.version !== 1 ||
    v.kdf !== "pbkdf2-sha256" ||
    !(v.salt instanceof Uint8Array) ||
    !(v.nonce instanceof Uint8Array) ||
    !(v.ciphertext instanceof Uint8Array)
  )
    throw new Error("Unsupported or malformed vault.");
  if (
    v.salt.byteLength < 16 ||
    v.nonce.byteLength !== 12 ||
    !v.ciphertext.byteLength
  )
    throw new Error("Malformed vault.");
  return {
    version: 1,
    kdf: "pbkdf2-sha256",
    salt: v.salt,
    nonce: v.nonce,
    ciphertext: v.ciphertext,
  };
}

export function decodeVaultContents(bytes: Uint8Array): VaultContents {
  const value = decodeCbor(bytes);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Malformed vault contents.");
  const v = value as Record<string, unknown>;
  const fields = [
    "identitySigningPublicKey",
    "identitySigningPrivateKey",
    "identityDhPublicKey",
    "identityDhPrivateKey",
    "signedPrekeyPrivateKey",
    "ratchetState",
    "historyKey",
  ] as const;
  if (
    v.version !== 1 ||
    typeof v.username !== "string" ||
    typeof v.installationId !== "string" ||
    !Array.isArray(v.oneTimePrekeyPrivateKeys) ||
    !fields.every((field) => v[field] instanceof Uint8Array) ||
    !v.oneTimePrekeyPrivateKeys.every((key) => key instanceof Uint8Array)
  )
    throw new Error("Malformed vault contents.");
  return {
    version: 1,
    username: v.username,
    installationId: v.installationId,
    identitySigningPublicKey: v.identitySigningPublicKey as Uint8Array,
    identitySigningPrivateKey: v.identitySigningPrivateKey as Uint8Array,
    identityDhPublicKey: v.identityDhPublicKey as Uint8Array,
    identityDhPrivateKey: v.identityDhPrivateKey as Uint8Array,
    signedPrekeyPrivateKey: v.signedPrekeyPrivateKey as Uint8Array,
    oneTimePrekeyPrivateKeys: v.oneTimePrekeyPrivateKeys as Uint8Array[],
    ratchetState: v.ratchetState as Uint8Array,
    historyKey: v.historyKey as Uint8Array,
  };
}
/** Browser-native local vault encryption. The passphrase never leaves this device. */
export class WebCryptoVaultCrypto implements VaultCrypto {
  private static readonly iterations = 600_000;
  private async key(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
    if (!passphrase) throw new Error("A vault passphrase is required.");
    const material = await crypto.subtle.importKey(
      "raw",
      browserBytes(new TextEncoder().encode(passphrase)),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: browserBytes(salt),
        iterations: WebCryptoVaultCrypto.iterations,
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }
  async encrypt(
    plaintext: Uint8Array,
    passphrase: string,
  ): Promise<EncryptedVault> {
    const salt = crypto.getRandomValues(new Uint8Array(16)),
      nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: browserBytes(nonce) },
        await this.key(passphrase, salt),
        browserBytes(plaintext),
      ),
    );
    return { version: 1, kdf: "pbkdf2-sha256", salt, nonce, ciphertext };
  }
  async decrypt(
    vault: EncryptedVault,
    passphrase: string,
  ): Promise<Uint8Array> {
    try {
      return new Uint8Array(
        await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: browserBytes(vault.nonce) },
          await this.key(passphrase, vault.salt),
          browserBytes(vault.ciphertext),
        ),
      );
    } catch {
      throw new Error(
        "Could not unlock this vault. Check the passphrase or vault file.",
      );
    }
  }
}
export function downloadVault(
  vaultBytes: Uint8Array,
  filename = "spm-vault.spmkey",
): void {
  // Copy into a browser-owned ArrayBuffer: callers may pass a SharedArrayBuffer view.
  const browserBytes = new Uint8Array(vaultBytes.byteLength);
  browserBytes.set(vaultBytes);
  const blob = new Blob([browserBytes.buffer], { type: VAULT_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
export async function readVaultFile(file: File): Promise<Uint8Array> {
  if (file.size > 5 * 1024 * 1024) throw new Error("Vault file is too large.");
  return new Uint8Array(await file.arrayBuffer());
}

/** Reads and validates locally. Calling this cannot initiate an HTTP or socket request. */
export async function importVaultFile(file: File): Promise<EncryptedVault> {
  return decodeEncryptedVault(await readVaultFile(file));
}

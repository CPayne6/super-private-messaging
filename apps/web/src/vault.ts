/** Browser-only vault boundary. No function here performs a network request. */
export const VAULT_MIME = "application/vnd.spm.key+cbor";
export interface EncryptedVault { version: 1; kdf: "argon2id"; salt: Uint8Array; nonce: Uint8Array; ciphertext: Uint8Array; }
export interface VaultCrypto {
  encrypt(plaintext: Uint8Array, passphrase: string): Promise<EncryptedVault>;
  decrypt(vault: EncryptedVault, passphrase: string): Promise<Uint8Array>;
}
/** Must be backed by independently reviewed Argon2id + XChaCha20-Poly1305 WASM before release. */
export class ReleaseGatedVaultCrypto implements VaultCrypto {
  async encrypt(): Promise<EncryptedVault> { throw new Error("Vault crypto provider unavailable: release gate requires vetted Argon2id/XChaCha20-Poly1305."); }
  async decrypt(): Promise<Uint8Array> { throw new Error("Vault crypto provider unavailable: release gate requires vetted Argon2id/XChaCha20-Poly1305."); }
}
export function downloadVault(vaultBytes: Uint8Array, filename = "spm-vault.spmkey"): void {
  // Copy into a browser-owned ArrayBuffer: callers may pass a SharedArrayBuffer view.
  const browserBytes = new Uint8Array(vaultBytes.byteLength); browserBytes.set(vaultBytes);
  const blob = new Blob([browserBytes.buffer], { type: VAULT_MIME }); const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}
export async function readVaultFile(file: File): Promise<Uint8Array> {
  if (file.size > 5 * 1024 * 1024) throw new Error("Vault file is too large.");
  return new Uint8Array(await file.arrayBuffer());
}

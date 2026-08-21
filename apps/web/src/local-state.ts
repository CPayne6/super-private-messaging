import {
  decodeEncryptedVault,
  decodeVaultContents,
  encodeEncryptedVault,
  encodeVaultContents,
  type EncryptedVault,
  type VaultContents,
} from "./vault.js";
import { debug, debugError } from "./debug.js";

const PROFILE_KEY = "spm.profile.v1";
const VAULT_KEY = "spm.vault.v1";

const encode = (value: Uint8Array): string =>
  btoa(String.fromCharCode(...value));
const decode = (value: string): Uint8Array =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

/**
 * Persists only the saved identity profile. Conversation keys are not stored
 * locally: after refresh they are unwrapped from server-held envelopes.
 */
export class PrivateLocalState {
  private read(key: string): Uint8Array | undefined {
    try {
      const value = localStorage.getItem(key);
      return value ? decode(value) : undefined;
    } catch (error) {
      debugError("storage.local.read.failed", error, { key });
      throw new Error("Browser site storage is unavailable for this app.");
    }
  }

  private write(key: string, value: Uint8Array): void {
    try {
      localStorage.setItem(key, encode(value));
      debug("storage.local.saved", { key, bytes: value.byteLength });
    } catch (error) {
      debugError("storage.local.write.failed", error, { key });
      throw new Error("Browser site storage is unavailable for this app.");
    }
  }

  async saveIdentity(identity: VaultContents): Promise<void> {
    this.write(PROFILE_KEY, encodeVaultContents(identity));
  }

  async identity(): Promise<VaultContents | undefined> {
    const profile = this.read(PROFILE_KEY);
    return profile ? decodeVaultContents(profile) : undefined;
  }

  /** Retained for the legacy DOM app; the interactive app uses `saveIdentity`. */
  async saveVault(vault: EncryptedVault): Promise<void> {
    this.write(VAULT_KEY, encodeEncryptedVault(vault));
  }

  /** Retained for the legacy DOM app; the interactive app uses `identity`. */
  async vault(): Promise<EncryptedVault | undefined> {
    const vault = this.read(VAULT_KEY);
    return vault ? decodeEncryptedVault(vault) : undefined;
  }

  async clear(): Promise<void> {
    try {
      localStorage.removeItem(PROFILE_KEY);
      localStorage.removeItem(VAULT_KEY);
      debug("storage.local.cleared");
    } catch (error) {
      debugError("storage.local.clear.failed", error);
      throw new Error("Browser site storage is unavailable for this app.");
    }
  }
}

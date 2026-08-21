import { normalizeUsername } from "@spm/protocol";
import { generateVaultContents } from "./identity.js";
import { PrivateLocalState } from "./local-state.js";
import {
  decodeVaultContents,
  downloadVault,
  encodeEncryptedVault,
  encodeVaultContents,
  importVaultFile,
  type VaultContents,
  type VaultCrypto,
} from "./vault.js";

/** Small accessible DOM app. Hosting code supplies the reviewed vault crypto adapter. */
export class MessagingApp {
  private readonly state = new PrivateLocalState();
  private unlocked?: VaultContents;
  constructor(
    private readonly root: HTMLElement,
    private readonly vaultCrypto: VaultCrypto,
  ) {}
  async start(): Promise<void> {
    this.keyAccess();
  }
  private render(markup: string): void {
    this.root.innerHTML = `<main class="spm-app">${markup}</main>`;
  }
  private keyAccess(): void {
    this.render(
      `<h1>Key access</h1><p>Your vault stays on this device. Move it only by offline media or cable.</p><section aria-labelledby="new-key"><h2 id="new-key">Create keys</h2><label>Username <input id="username" autocomplete="username" required></label><label>Passphrase <input id="passphrase" type="password" autocomplete="new-password" required></label><label>Confirm passphrase <input id="confirm" type="password" autocomplete="new-password" required></label><button id="create">Create encrypted vault</button></section><section aria-labelledby="import-key"><h2 id="import-key">Import an offline vault</h2><input id="vault-file" type="file" accept=".spmkey,${"application/vnd.spm.key+cbor"}" aria-describedby="offline"><p id="offline">This file is parsed locally and is never uploaded.</p><label>Passphrase <input id="unlock-passphrase" type="password" autocomplete="current-password"></label><button id="unlock">Unlock vault</button></section><p id="status" role="status" aria-live="polite"></p>`,
    );
    const $ = <T extends HTMLElement>(id: string): T =>
      this.root.querySelector(`#${id}`)!;
    $("create").addEventListener("click", async () => {
      const username = $("username") as HTMLInputElement,
        pass = $("passphrase") as HTMLInputElement,
        confirm = $("confirm") as HTMLInputElement;
      try {
        if (pass.value !== confirm.value)
          throw new Error("Passphrases do not match.");
        const contents = await generateVaultContents(
          normalizeUsername(username.value),
        );
        const encrypted = await this.vaultCrypto.encrypt(
          encodeVaultContents(contents),
          pass.value,
        );
        await this.state.saveVault(encrypted);
        downloadVault(
          encodeEncryptedVault(encrypted),
          `${contents.username}.spmkey`,
        );
        $("status").textContent =
          "Vault downloaded. Keep it offline before registering your public keys.";
      } catch (error) {
        $("status").textContent =
          error instanceof Error ? error.message : "Could not create vault.";
      }
    });
    $("unlock").addEventListener("click", async () => {
      const file = $("vault-file") as HTMLInputElement,
        pass = $("unlock-passphrase") as HTMLInputElement;
      try {
        const vault = file.files?.[0]
          ? await importVaultFile(file.files[0]!)
          : await this.state.vault();
        if (!vault) throw new Error("Choose a vault file first.");
        const plaintext = await this.vaultCrypto.decrypt(vault, pass.value);
        this.unlocked = decodeVaultContents(plaintext);
        await this.state.saveVault(vault);
        this.messages();
      } catch {
        $("status").textContent =
          "Could not unlock this vault. Check the passphrase and file.";
      }
    });
  }
  private messages(): void {
    this.render(
      `<h1>Messages</h1><p>Unlocked as ${this.unlocked?.username ?? ""}</p><section aria-label="Online users"><h2>Online users</h2><ul id="online"><li>Connect to see presence</li></ul></section><section><h2>New encrypted message</h2><label>Recipient <input id="recipient" autocomplete="off"></label><label>Message <textarea id="message" required></textarea></label><button disabled title="A reviewed Signal adapter is required before sending">Send</button></section><button id="settings">Key &amp; account settings</button>`,
    );
    this.root
      .querySelector("#settings")!
      .addEventListener("click", () => this.settings());
  }
  private settings(): void {
    this.render(
      `<h1>Key &amp; account settings</h1><p>Download a current vault before moving devices. Locking clears keys from memory.</p><button id="lock">Lock</button><button id="remove">Remove local encrypted data</button><p id="status" role="status" aria-live="polite"></p>`,
    );
    this.root.querySelector("#lock")!.addEventListener("click", () => {
      this.unlocked = undefined;
      this.keyAccess();
    });
    this.root.querySelector("#remove")!.addEventListener("click", async () => {
      if (
        confirm(
          "Remove the encrypted vault and local encrypted history from this browser? This cannot be undone.",
        )
      ) {
        this.unlocked = undefined;
        await this.state.clear();
        this.keyAccess();
      }
    });
  }
}

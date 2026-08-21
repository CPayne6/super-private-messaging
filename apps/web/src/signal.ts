import { canonicalCbor } from "@spm/protocol";
import {
  deriveX25519,
  importX25519PublicKey,
} from "./x25519.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const bytes = (value: Uint8Array): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(value);

export interface ConversationParticipantKey {
  username: string;
  identityDhPublicKey: Uint8Array;
  keyVersion: number;
}
export interface WrappedConversationKey {
  username: string;
  keyVersion: number;
  ephemeralPublicKey: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}
export interface EncryptedConversationMessage {
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

async function wrappingKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  context: Uint8Array,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    bytes(await deriveX25519(privateKey, publicKey)),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(),
      info: bytes(context),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Browser-only conversation encryption. Plaintext keys never leave this process. */
export class WebCryptoMessageEngine {
  constructor(
    private readonly username: string,
    private readonly identityPrivateKey: Uint8Array,
  ) {}

  private wrapContext(
    conversationId: string,
    participant: string,
    keyVersion: number,
  ): Uint8Array {
    return canonicalCbor({
      purpose: "conversation-key",
      version: 1,
      conversationId,
      participant,
      keyVersion,
    });
  }
  private messageContext(conversationId: string): Uint8Array {
    return canonicalCbor({
      purpose: "conversation-message",
      version: 1,
      conversationId,
    });
  }
  private async ownPrivateKey(): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      "pkcs8",
      bytes(this.identityPrivateKey),
      { name: "X25519" },
      false,
      ["deriveBits"],
    );
  }

  async createConversation(
    conversationId: string,
    participants: readonly ConversationParticipantKey[],
  ): Promise<{ key: Uint8Array; envelopes: WrappedConversationKey[] }> {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const ephemeral = (await crypto.subtle.generateKey(
      { name: "X25519" },
      true,
      ["deriveBits"],
    )) as CryptoKeyPair;
    const ephemeralPublicKey = new Uint8Array(
      await crypto.subtle.exportKey("raw", ephemeral.publicKey),
    );
    const envelopes = await Promise.all(
      participants.map(async (participant) => {
        const publicKey = await importX25519PublicKey(
          participant.identityDhPublicKey,
        );
        const nonce = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = new Uint8Array(
          await crypto.subtle.encrypt(
            {
              name: "AES-GCM",
              iv: bytes(nonce),
              additionalData: bytes(
                this.wrapContext(
                  conversationId,
                  participant.username,
                  participant.keyVersion,
                ),
              ),
            },
            await wrappingKey(
              ephemeral.privateKey,
              publicKey,
              this.wrapContext(
                conversationId,
                participant.username,
                participant.keyVersion,
              ),
            ),
            bytes(key),
          ),
        );
        return {
          username: participant.username,
          keyVersion: participant.keyVersion,
          ephemeralPublicKey,
          nonce,
          ciphertext,
        };
      }),
    );
    return { key, envelopes };
  }

  async unwrapConversationKey(
    conversationId: string,
    envelope: WrappedConversationKey,
  ): Promise<Uint8Array> {
    if (envelope.username !== this.username)
      throw new Error("Conversation key belongs to a different identity.");
    const ephemeral = await importX25519PublicKey(envelope.ephemeralPublicKey);
    return new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: bytes(envelope.nonce),
          additionalData: bytes(
            this.wrapContext(
              conversationId,
              this.username,
              envelope.keyVersion,
            ),
          ),
        },
        await wrappingKey(
          await this.ownPrivateKey(),
          ephemeral,
          this.wrapContext(conversationId, this.username, envelope.keyVersion),
        ),
        bytes(envelope.ciphertext),
      ),
    );
  }

  async encrypt(
    conversationId: string,
    key: Uint8Array,
    plaintext: string,
  ): Promise<EncryptedConversationMessage> {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const aes = await crypto.subtle.importKey(
      "raw",
      bytes(key),
      { name: "AES-GCM" },
      false,
      ["encrypt"],
    );
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: bytes(nonce),
          additionalData: bytes(this.messageContext(conversationId)),
        },
        aes,
        encoder.encode(plaintext),
      ),
    );
    return { nonce, ciphertext };
  }

  async decrypt(
    conversationId: string,
    key: Uint8Array,
    message: EncryptedConversationMessage,
  ): Promise<string> {
    const aes = await crypto.subtle.importKey(
      "raw",
      bytes(key),
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bytes(message.nonce),
        additionalData: bytes(this.messageContext(conversationId)),
      },
      aes,
      bytes(message.ciphertext),
    );
    return decoder.decode(plaintext);
  }
}

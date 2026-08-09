import { DirectEnvelope, ErrorCode, ProtocolError, PublicPrekeyBundle, normalizeUsername } from "@spm/protocol";

export interface Challenge { id: string; username: string; purpose: string; route: string; expiresAt: number; usedAt?: number; }
export interface VerifiedRequest { username: string; installationId: string; requestId: string; }
export interface IdentityRepository {
  findBundle(username: string): Promise<PublicPrekeyBundle | undefined>;
  saveIdentity(bundle: PublicPrekeyBundle): Promise<void>;
  activateInstallation(username: string, installationId: string): Promise<void>;
  isActiveInstallation(username: string, installationId: string): Promise<boolean>;
}
export interface MessageRepository {
  append(envelope: DirectEnvelope, sender: string): Promise<{ messageId: string; duplicate: boolean }>;
  listFor(username: string, cursor?: string): Promise<readonly DirectEnvelope[]>;
  deleteFor(username: string, conversationId: string): Promise<void>;
}
/** Signature verification is an adapter so the HTTP layer never handles secret key material. */
export interface SignatureVerifier { verify(username: string, input: Uint8Array, signature: Uint8Array): Promise<boolean>; }

export class MessagingService {
  constructor(private identities: IdentityRepository, private messages: MessageRepository) {}
  async register(bundle: PublicPrekeyBundle): Promise<void> {
    bundle.username = normalizeUsername(bundle.username);
    if (await this.identities.findBundle(bundle.username)) throw new Error("Username is permanently bound; use a signed key rotation.");
    await this.identities.saveIdentity(bundle);
  }
  async lookup(username: string): Promise<PublicPrekeyBundle> {
    const bundle = await this.identities.findBundle(normalizeUsername(username));
    if (!bundle) throw new Error("Recipient not found");
    return bundle;
  }
  async send(auth: VerifiedRequest, envelope: DirectEnvelope): Promise<{ messageId: string; duplicate: boolean }> {
    if (!await this.identities.isActiveInstallation(auth.username, auth.installationId))
      throw new ProtocolError(ErrorCode.INSTALLATION_REPLACED, "This vault is no longer the active installation.");
    if (envelope.recipient !== normalizeUsername(envelope.recipient) || !envelope.ciphertext.byteLength)
      throw new ProtocolError(ErrorCode.ENVELOPE_INVALID, "Invalid encrypted envelope.");
    return this.messages.append(envelope, auth.username);
  }
}

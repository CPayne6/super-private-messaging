import { DirectEnvelope, PublicPrekeyBundle } from "@spm/protocol";
import { Challenge, IdentityService, MessagingService, RequestAuthenticator, SignedIdentityRotation, SignedRequestProof } from "./domain.js";

/**
 * Framework-neutral private REST controller. A Nest controller/guard can delegate here;
 * keeping bytes at this boundary prevents accidental JSON canonicalisation before signing.
 */
export class PrivateApiController {
  constructor(private readonly auth: RequestAuthenticator, private readonly identities: IdentityService, private readonly messages: MessagingService) {}

  register(bundle: PublicPrekeyBundle): Promise<void> { return this.identities.register(bundle); }
  lookup(username: string, reserveOneTimePrekey = false): Promise<PublicPrekeyBundle> { return this.identities.lookup(username, reserveOneTimePrekey); }
  rotate(username: string, rotation: SignedIdentityRotation): Promise<void> { return this.identities.rotate(username, rotation); }

  async activate(challenge: Challenge, proof: SignedRequestProof, payloadHash: Uint8Array): Promise<void> {
    const auth = await this.auth.authenticate(challenge, proof, payloadHash);
    await this.identities.activate(auth);
  }
  async send(challenge: Challenge, proof: SignedRequestProof, payloadHash: Uint8Array, envelope: DirectEnvelope): Promise<{ messageId: string; duplicate: boolean }> {
    return this.messages.send(await this.auth.authenticate(challenge, proof, payloadHash), envelope);
  }
  async messagesFor(challenge: Challenge, proof: SignedRequestProof, payloadHash: Uint8Array, cursor?: string, limit?: number) {
    return this.messages.list(await this.auth.authenticate(challenge, proof, payloadHash), cursor, limit);
  }
  async deleteConversation(challenge: Challenge, proof: SignedRequestProof, payloadHash: Uint8Array, conversationId: string): Promise<void> {
    await this.messages.deleteConversation(await this.auth.authenticate(challenge, proof, payloadHash), conversationId);
  }
}

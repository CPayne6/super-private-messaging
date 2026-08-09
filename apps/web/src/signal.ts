import { DirectEnvelope, PublicPrekeyBundle } from "@spm/protocol";
/** Do not implement X3DH or Double Ratchet here. Supply an independently vetted browser binding. */
export interface SignalEngine {
  encrypt(recipient: PublicPrekeyBundle, plaintext: string): Promise<DirectEnvelope>;
  decrypt(envelope: DirectEnvelope): Promise<string>;
  processPendingBeforeSend(): Promise<void>;
}
export class ReleaseGatedSignalEngine implements SignalEngine {
  async encrypt(): Promise<DirectEnvelope> { throw new Error("Signal engine unavailable pending independent cryptography review."); }
  async decrypt(): Promise<string> { throw new Error("Signal engine unavailable pending independent cryptography review."); }
  async processPendingBeforeSend(): Promise<void> { throw new Error("Signal engine unavailable pending independent cryptography review."); }
}

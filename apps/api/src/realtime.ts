import { DirectEnvelope, ErrorCode, ProtocolError } from "@spm/protocol";

/** Redis-only, expiring presence; it intentionally contains no messages or key material. */
export interface PresenceStore {
  increment(username: string, connectionId: string, ttlSeconds: number): Promise<number>;
  decrement(username: string, connectionId: string): Promise<number>;
  heartbeat(username: string, connectionId: string, ttlSeconds: number): Promise<void>;
  online(): Promise<readonly string[]>;
}
export interface RealtimeAuth { username: string; installationId: string; }
export interface InstallationGuard { active(username: string, installationId: string): Promise<boolean>; }
export interface Fanout { publishRecipient(username: string, envelope: DirectEnvelope): Promise<void>; publishPresence(users: readonly string[]): Promise<void>; }

export class RealtimeGateway {
  constructor(private presence: PresenceStore, private installations: InstallationGuard, private fanout: Fanout) {}
  async connect(auth: RealtimeAuth, connectionId: string): Promise<void> {
    if (!await this.installations.active(auth.username, auth.installationId)) throw new ProtocolError(ErrorCode.INSTALLATION_REPLACED, "Installation replaced.");
    await this.presence.increment(auth.username, connectionId, 90);
    await this.fanout.publishPresence(await this.presence.online());
  }
  async disconnect(username: string, connectionId: string): Promise<void> {
    await this.presence.decrement(username, connectionId);
    await this.fanout.publishPresence(await this.presence.online());
  }
  async assertActive(auth: RealtimeAuth): Promise<void> {
    if (!await this.installations.active(auth.username, auth.installationId)) throw new ProtocolError(ErrorCode.INSTALLATION_REPLACED, "Installation replaced.");
  }
}

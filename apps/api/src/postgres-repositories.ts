import { DatabaseService } from "./database.module.js";
import type { Challenge, ChallengeRepository, IdentityRepository, MessagePage, MessageRepository } from "./domain.js";
import type { DirectEnvelope, PublicPrekeyBundle } from "@spm/protocol";

const bytes = (value: Buffer): Uint8Array => new Uint8Array(value);

export class PostgresRepositories implements ChallengeRepository, IdentityRepository, MessageRepository {
  constructor(private readonly pool: DatabaseService) {}
  async consume(challenge: Challenge, now: number): Promise<boolean> {
    const result = await this.pool.query("UPDATE consumed_challenges SET consumed_at = now() WHERE challenge_id = $1 AND username = $2 AND purpose = $3 AND route = $4 AND method = $5 AND expires_at > to_timestamp($6 / 1000.0) AND consumed_at IS NULL", [challenge.id, challenge.username, challenge.purpose, challenge.route, challenge.method, now]);
    return result.rowCount === 1;
  }
  async findBundle(username: string): Promise<PublicPrekeyBundle | undefined> {
    const result = await this.pool.query("SELECT u.username, u.identity_signing_public_key, u.identity_dh_public_key, u.key_version, p.public_key AS signed_prekey, p.key_id AS signed_prekey_id, p.signature AS signed_prekey_signature FROM users u JOIN signed_prekeys p ON p.username = u.username AND p.key_version = u.key_version AND p.active WHERE u.username = $1", [username]);
    const row = result.rows[0]; if (!row) return undefined;
    return { username: row.username, identitySigningPublicKey: bytes(row.identity_signing_public_key), identityDhPublicKey: bytes(row.identity_dh_public_key), keyVersion: row.key_version, signedPrekey: bytes(row.signed_prekey), signedPrekeyId: row.signed_prekey_id, signedPrekeySignature: bytes(row.signed_prekey_signature) };
  }
  async saveIdentity(bundle: PublicPrekeyBundle): Promise<void> {
    const client = await this.pool.connect(); try { await client.query("BEGIN"); await client.query("INSERT INTO users(username, identity_signing_public_key, identity_dh_public_key, key_version) VALUES ($1,$2,$3,$4)", [bundle.username, Buffer.from(bundle.identitySigningPublicKey), Buffer.from(bundle.identityDhPublicKey), bundle.keyVersion]); await client.query("INSERT INTO signed_prekeys(username,key_version,key_id,public_key,signature) VALUES($1,$2,$3,$4,$5)", [bundle.username,bundle.keyVersion,bundle.signedPrekeyId,Buffer.from(bundle.signedPrekey),Buffer.from(bundle.signedPrekeySignature)]); if (bundle.oneTimePrekey && bundle.oneTimePrekeyId !== undefined) await client.query("INSERT INTO one_time_prekeys(username,key_version,key_id,public_key) VALUES($1,$2,$3,$4)", [bundle.username,bundle.keyVersion,bundle.oneTimePrekeyId,Buffer.from(bundle.oneTimePrekey)]); await client.query("COMMIT"); } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async activateInstallation(username: string, installationId: string): Promise<void> { await this.pool.query("INSERT INTO installations(username,installation_id) VALUES($1,$2) ON CONFLICT(username) DO UPDATE SET installation_id=excluded.installation_id, activated_at=now()", [username, installationId]); }
  async isActiveInstallation(username: string, installationId: string): Promise<boolean> { return (await this.pool.query("SELECT 1 FROM installations WHERE username=$1 AND installation_id=$2", [username, installationId])).rowCount === 1; }
  async consumeOneTimePrekey(): Promise<undefined> { return undefined; }
  async rotateIdentity(): Promise<void> { throw new Error("Identity rotation is not implemented yet."); }
  async append(envelope: DirectEnvelope, sender: string): Promise<{ messageId: string; duplicate: boolean }> { const client = await this.pool.connect(); try { await client.query("BEGIN"); const existing = await client.query("SELECT id FROM direct_messages WHERE sender=$1 AND idempotency_id=$2", [sender,envelope.idempotencyId]); if (existing.rowCount) { await client.query("COMMIT"); return { messageId: existing.rows[0].id, duplicate: true }; } const messageId = crypto.randomUUID(), conversationId = crypto.randomUUID(); await client.query("INSERT INTO direct_messages(id,conversation_id,sender,sender_key_version,idempotency_id,sent_at) VALUES($1,$2,$3,1,$4,to_timestamp($5/1000.0))", [messageId,conversationId,sender,envelope.idempotencyId,envelope.sentAt]); await client.query("INSERT INTO recipient_envelopes(message_id,recipient,recipient_key_version,ciphertext,prekey_message) VALUES($1,$2,$3,$4,$5)", [messageId,envelope.recipient,envelope.recipientKeyVersion,Buffer.from(envelope.ciphertext),envelope.prekeyMessage]); await client.query("COMMIT"); return { messageId, duplicate: false }; } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
  async listFor(username: string, _cursor?: string, limit = 50): Promise<MessagePage> { const rows = await this.pool.query("SELECT d.id,d.idempotency_id,d.sent_at,r.recipient,r.recipient_key_version,r.prekey_message,r.ciphertext FROM recipient_envelopes r JOIN direct_messages d ON d.id=r.message_id WHERE r.recipient=$1 ORDER BY r.received_at DESC LIMIT $2", [username,limit]); return { envelopes: rows.rows.map(row => ({ version: 1, idempotencyId: row.idempotency_id, recipient: row.recipient, recipientKeyVersion: row.recipient_key_version, prekeyMessage: row.prekey_message, ciphertext: bytes(row.ciphertext), sentAt: new Date(row.sent_at).getTime() })) }; }
  async deleteFor(): Promise<void> { /* conversation deletion will be added with client-side conversation IDs. */ }
}

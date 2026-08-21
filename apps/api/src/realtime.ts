import {
  DirectEnvelope,
  envelopeBytes,
  ErrorCode,
  ProtocolError,
  SHA256_BYTES,
  SignedRequest,
  signingBytes
} from "@spm/protocol";

/** The only public events emitted by the realtime transport. */
export const RealtimeEvent = {
  AUTHENTICATE: "authenticate",
  HEARTBEAT: "heartbeat",
  SEND: "send",
  PRESENCE: "presence",
  ENVELOPE: "envelope",
  INSTALLATION_REPLACED: "installation-replaced"
} as const;

export const SOCKET_CONNECT_METHOD = "CONNECT";
export const SOCKET_CONNECT_ROUTE = "/realtime";
export const PRESENCE_TTL_SECONDS = 90;

/** Redis-only, expiring presence; it intentionally contains no messages or key material. */
export interface PresenceStore {
  increment(username: string, connectionId: string, ttlSeconds: number): Promise<number>;
  decrement(username: string, connectionId: string): Promise<number>;
  heartbeat(username: string, connectionId: string, ttlSeconds: number): Promise<void>;
  online(): Promise<readonly string[]>;
}

/**
 * Deliberately small Redis contract.  ioredis/node-redis adapters can implement this
 * with EVAL without coupling the domain to either package.
 */
export interface RedisScriptClient {
  eval(script: string, keys: readonly string[], args: readonly string[]): Promise<unknown>;
}

/**
 * Atomic Redis presence implementation. A username has a sorted set of connection
 * expiry times; a second sorted set stores each username's latest expiry. This gives
 * multi-tab counts and expiry-based disconnect grace without durable state.
 */
export class RedisPresenceStore implements PresenceStore {
  constructor(private readonly redis: RedisScriptClient, private readonly prefix = "spm:presence") {}

  async increment(username: string, connectionId: string, ttlSeconds: number): Promise<number> {
    return this.countScript("add", username, connectionId, ttlSeconds);
  }

  async decrement(username: string, connectionId: string): Promise<number> {
    return this.countScript("remove", username, connectionId, 0);
  }

  async heartbeat(username: string, connectionId: string, ttlSeconds: number): Promise<void> {
    await this.countScript("add", username, connectionId, ttlSeconds);
  }

  async online(): Promise<readonly string[]> {
    const now = Date.now();
    const result = await this.redis.eval(ONLINE_SCRIPT, [this.usersKey()], [String(now)]);
    if (!Array.isArray(result) || result.some((username) => typeof username !== "string"))
      throw new Error("Redis returned an invalid presence list.");
    return [...result].sort();
  }

  private async countScript(operation: "add" | "remove", username: string, connectionId: string, ttlSeconds: number): Promise<number> {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 0) throw new TypeError("Presence TTL must be a non-negative integer.");
    const now = Date.now();
    const result = await this.redis.eval(
      COUNT_SCRIPT,
      [this.connectionKey(username), this.usersKey()],
      [operation, username, connectionId, String(now), String(ttlSeconds * 1000)]
    );
    if (typeof result !== "number" || !Number.isSafeInteger(result) || result < 0)
      throw new Error("Redis returned an invalid presence count.");
    return result;
  }

  private connectionKey(username: string): string { return `${this.prefix}:connections:${username}`; }
  private usersKey(): string { return `${this.prefix}:users`; }
}

// KEYS[1] is the per-user connection-expiry ZSET and KEYS[2] is username -> max expiry.
const COUNT_SCRIPT = `
local mode, username, connection, now, ttl = ARGV[1], ARGV[2], ARGV[3], tonumber(ARGV[4]), tonumber(ARGV[5])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if mode == 'add' then redis.call('ZADD', KEYS[1], now + ttl, connection) else redis.call('ZREM', KEYS[1], connection) end
local count = redis.call('ZCARD', KEYS[1])
if count == 0 then
  redis.call('ZREM', KEYS[2], username)
  redis.call('DEL', KEYS[1])
else
  local latest = redis.call('ZREVRANGE', KEYS[1], 0, 0, 'WITHSCORES')[2]
  redis.call('ZADD', KEYS[2], tonumber(latest), username)
  redis.call('PEXPIRE', KEYS[1], math.max(1, tonumber(latest) - now))
end
return count`;

// A username is online until its last live connection expires. Per-user ZSETs are
// removed by the next connect/disconnect; they have a Redis TTL as a backstop.
const ONLINE_SCRIPT = `
local now = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
return redis.call('ZRANGE', KEYS[1], 0, -1)`;

export interface RealtimeAuth { username: string; installationId: string; }
export interface InstallationGuard { active(username: string, installationId: string): Promise<boolean>; }
export interface Fanout {
  publishRecipient(username: string, envelope: DirectEnvelope): Promise<void>;
  publishPresence(users: readonly string[]): Promise<void>;
}

/** A socket transport adapter (Socket.IO, ws, or a test double). */
export interface RealtimeSocket {
  readonly id: string;
  emit(event: string, payload?: unknown): void;
  disconnect(close?: boolean): void;
}

/** Validates challenge contents and atomically marks a challenge consumed. */
export interface SocketChallengeStore {
  /** The persisted canonical challenge must match the client proof byte-for-byte. */
  find(requestId: string): Promise<{ username: string; request: SignedRequest; used: boolean } | undefined>;
  consume(requestId: string): Promise<boolean>;
}
export interface IdentitySignatureVerifier {
  verify(username: string, input: Uint8Array, signature: Uint8Array): Promise<boolean>;
}
export interface SignedSocketAuthentication { request: SignedRequest; signature: Uint8Array; }
export interface SignedSocketSend { envelope: DirectEnvelope; signature: Uint8Array; }

/**
 * Shared signed-challenge semantics for a Socket.IO handshake. Challenge inspection
 * precedes signature verification so a bad signature cannot consume a valid challenge;
 * consume must be atomic and returns false on a concurrent/replayed consume.
 */
export class SignedSocketAuthenticator {
  constructor(private readonly challenges: SocketChallengeStore, private readonly signatures: IdentitySignatureVerifier, private readonly now = () => Date.now()) {}

  async authenticate(input: SignedSocketAuthentication): Promise<RealtimeAuth> {
    const request = input.request;
    if (!isSocketConnectRequest(request) || !isBytes(input.signature)) throw invalidSignature();
    const challenge = await this.challenges.find(request.requestId);
    if (!challenge) throw new ProtocolError(ErrorCode.CHALLENGE_EXPIRED, "Socket challenge has expired.");
    if (challenge.used) throw new ProtocolError(ErrorCode.CHALLENGE_USED, "Socket challenge was already used.");
    if (challenge.request.expiresAt <= this.now() || request.expiresAt <= this.now())
      throw new ProtocolError(ErrorCode.CHALLENGE_EXPIRED, "Socket challenge has expired.");
    if (!sameBytes(signingBytes(challenge.request), signingBytes(request))) throw invalidSignature();
    // The server-owned challenge maps requestId to the username; the client never
    // supplies a username in the handshake payload.
    if (!await this.signatures.verify(challenge.username, signingBytes(request), input.signature))
      throw invalidSignature();
    if (!await this.challenges.consume(request.requestId))
      throw new ProtocolError(ErrorCode.CHALLENGE_USED, "Socket challenge was already used.");
    return { username: challenge.username, installationId: request.installationId };
  }
}

/** Persistence boundary: resolve only after the encrypted envelope is committed. */
export interface MessageCommitter {
  commit(auth: RealtimeAuth, envelope: DirectEnvelope): Promise<{ messageId: string; duplicate: boolean }>;
}

export class RealtimeGateway {
  private readonly connections = new Map<string, { auth: RealtimeAuth; socket: RealtimeSocket }>();

  constructor(
    private readonly presence: PresenceStore,
    private readonly installations: InstallationGuard,
    private readonly fanout: Fanout,
    private readonly messages?: MessageCommitter,
    private readonly signatures?: IdentitySignatureVerifier
  ) {}

  async connect(auth: RealtimeAuth, connectionId: string): Promise<void> {
    await this.assertActive(auth);
    await this.presence.increment(auth.username, connectionId, PRESENCE_TTL_SECONDS);
    await this.publishPresence();
  }

  async attach(socket: RealtimeSocket, auth: RealtimeAuth): Promise<void> {
    await this.connect(auth, socket.id);
    this.connections.set(socket.id, { auth, socket });
  }

  async disconnect(username: string, connectionId: string): Promise<void> {
    this.connections.delete(connectionId);
    await this.presence.decrement(username, connectionId);
    await this.publishPresence();
  }

  async heartbeat(auth: RealtimeAuth, connectionId: string): Promise<void> {
    await this.assertActive(auth);
    await this.presence.heartbeat(auth.username, connectionId, PRESENCE_TTL_SECONDS);
  }

  async send(auth: RealtimeAuth, signed: SignedSocketSend): Promise<{ messageId: string; duplicate: boolean }> {
    if (!this.messages) throw new Error("Realtime message committer is not configured.");
    await this.assertActive(auth);
    if (!isEnvelope(signed.envelope)) throw new ProtocolError(ErrorCode.ENVELOPE_INVALID, "Invalid encrypted envelope.");
    if (!isBytes(signed.signature) || !await this.verifyEnvelope(auth.username, signed.envelope, signed.signature)) throw invalidSignature();
    const committed = await this.messages.commit(auth, signed.envelope);
    // Fan-out is intentionally after the durable commit. Retries are recovered through history sync.
    if (!committed.duplicate) await this.fanout.publishRecipient(signed.envelope.recipient, signed.envelope);
    return committed;
  }

  /** Called by the installation activation subscriber in every Socket.IO worker. */
  async invalidateInstallation(username: string, activeInstallationId: string): Promise<void> {
    const stale = [...this.connections.values()].filter(({ auth }) => auth.username === username && auth.installationId !== activeInstallationId);
    await Promise.all(stale.map(async ({ auth, socket }) => {
      socket.emit(RealtimeEvent.INSTALLATION_REPLACED, { code: ErrorCode.INSTALLATION_REPLACED });
      socket.disconnect(true);
      await this.disconnect(auth.username, socket.id);
    }));
  }

  async assertActive(auth: RealtimeAuth): Promise<void> {
    if (!await this.installations.active(auth.username, auth.installationId))
      throw new ProtocolError(ErrorCode.INSTALLATION_REPLACED, "Installation replaced.");
  }

  private async verifyEnvelope(username: string, envelope: DirectEnvelope, signature: Uint8Array): Promise<boolean> {
    // InstallationGuard may also implement verification in a small deployment; keeping
    // this separate avoids ever accepting a transport-provided username as authority.
    if (!this.signatures) throw new Error("Realtime message signature verifier is not configured.");
    return this.signatures.verify(username, envelopeBytes(envelope), signature);
  }

  private async publishPresence(): Promise<void> { await this.fanout.publishPresence(await this.presence.online()); }
}

/**
 * Per-socket state holder for a Socket.IO gateway adapter. The NestJS/Socket.IO layer
 * calls these methods from `authenticate`, `heartbeat`, `send`, and `disconnect`
 * handlers; no event is allowed to use a client-supplied username or installation id.
 */
export class RealtimeSocketSession {
  private auth?: RealtimeAuth;

  constructor(
    private readonly socket: RealtimeSocket,
    private readonly authenticator: SignedSocketAuthenticator,
    private readonly gateway: RealtimeGateway
  ) {}

  async authenticate(input: SignedSocketAuthentication): Promise<RealtimeAuth> {
    if (this.auth) throw new ProtocolError(ErrorCode.CHALLENGE_USED, "Socket is already authenticated.");
    const auth = await this.authenticator.authenticate(input);
    await this.gateway.attach(this.socket, auth);
    this.auth = auth;
    return auth;
  }

  async heartbeat(): Promise<void> { await this.gateway.heartbeat(this.requireAuth(), this.socket.id); }
  async send(input: SignedSocketSend): Promise<{ messageId: string; duplicate: boolean }> {
    return this.gateway.send(this.requireAuth(), input);
  }
  async disconnect(): Promise<void> {
    if (!this.auth) return;
    const auth = this.auth;
    this.auth = undefined;
    await this.gateway.disconnect(auth.username, this.socket.id);
  }

  private requireAuth(): RealtimeAuth {
    if (!this.auth) throw new ProtocolError(ErrorCode.INVALID_SIGNATURE, "Socket is not authenticated.");
    return this.auth;
  }
}

function isSocketConnectRequest(request: SignedRequest): boolean {
  return request?.version === 1 && request.purpose === "socket-connect" && request.method === SOCKET_CONNECT_METHOD &&
    request.route === SOCKET_CONNECT_ROUTE && typeof request.installationId === "string" && request.installationId.length > 0 &&
    typeof request.requestId === "string" && request.requestId.length > 0 && Number.isSafeInteger(request.expiresAt) &&
    request.expiresAt > 0 && isBytes(request.payloadHash) && request.payloadHash.byteLength === SHA256_BYTES;
}

function isEnvelope(envelope: DirectEnvelope): boolean {
  return envelope?.version === 1 && typeof envelope.idempotencyId === "string" && envelope.idempotencyId.length > 0 &&
    typeof envelope.recipient === "string" && envelope.recipient.length > 0 && Number.isSafeInteger(envelope.recipientKeyVersion) &&
    envelope.recipientKeyVersion >= 0 && typeof envelope.prekeyMessage === "boolean" && isBytes(envelope.ciphertext) &&
    envelope.ciphertext.byteLength > 0 && Number.isSafeInteger(envelope.sentAt) && envelope.sentAt > 0;
}
function isBytes(value: unknown): value is Uint8Array { return value instanceof Uint8Array; }
function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let different = 0;
  for (let index = 0; index < left.byteLength; index += 1) different |= left[index]! ^ right[index]!;
  return different === 0;
}
function invalidSignature(): ProtocolError { return new ProtocolError(ErrorCode.INVALID_SIGNATURE, "Invalid socket signature."); }

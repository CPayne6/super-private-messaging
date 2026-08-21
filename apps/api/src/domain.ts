import {
  DirectEnvelope,
  ErrorCode,
  MAX_MESSAGE_BYTES,
  ProtocolError,
  PublicPrekeyBundle,
  SignedRequest,
  canonicalCbor,
  envelopeBytes,
  normalizeUsername,
  signingBytes
} from "@spm/protocol";

/** A challenge is public, short lived, and can be used exactly once. */
export interface Challenge {
  id: string;
  username: string;
  purpose: SignedRequest["purpose"];
  route: string;
  method: string;
  expiresAt: number;
}

export interface SignedRequestProof { request: SignedRequest; signature: Uint8Array; }
/** Signature made by the current identity key while changing public identity material. */
export interface SignedIdentityRotation { bundle: PublicPrekeyBundle; signature: Uint8Array; }
export interface VerifiedRequest { username: string; installationId: string; requestId: string; }

export interface ChallengeRepository {
  /** Atomically records use. Returns false if the challenge is absent, expired, or already used. */
  consume(challenge: Challenge, now: number): Promise<boolean>;
}

export interface IdentityRepository {
  findBundle(username: string): Promise<PublicPrekeyBundle | undefined>;
  saveIdentity(bundle: PublicPrekeyBundle): Promise<void>;
  /** Must invalidate any prior installation in the same transaction. */
  activateInstallation(username: string, installationId: string): Promise<void>;
  isActiveInstallation(username: string, installationId: string): Promise<boolean>;
  /** Returns an unconsumed key and marks it consumed atomically, if one exists. */
  consumeOneTimePrekey(username: string): Promise<{ key: Uint8Array; keyId: number } | undefined>;
  rotateIdentity(currentUsername: string, replacement: PublicPrekeyBundle): Promise<void>;
}

export interface MessagePage { envelopes: readonly DirectEnvelope[]; nextCursor?: string; }
export interface MessageRepository {
  /** Persists message and recipient envelope in one transaction; idempotency is scoped to sender. */
  append(envelope: DirectEnvelope, sender: string): Promise<{ messageId: string; duplicate: boolean }>;
  listFor(username: string, cursor?: string, limit?: number): Promise<MessagePage>;
  /** Only marks ciphertext addressed to username as deleted. It never affects the other recipient. */
  deleteFor(username: string, conversationId: string): Promise<void>;
}

/** The concrete adapter uses WebCrypto/Node crypto Ed25519 verification. No private key crosses this boundary. */
export interface SignatureVerifier {
  verify(username: string, input: Uint8Array, signature: Uint8Array): Promise<boolean>;
  verifyPublicKey(publicKey: Uint8Array, input: Uint8Array, signature: Uint8Array): Promise<boolean>;
}

const isUuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function invalidEnvelope(message: string): ProtocolError {
  return new ProtocolError(ErrorCode.ENVELOPE_INVALID, message);
}

function assertBundle(bundle: PublicPrekeyBundle): void {
  bundle.username = normalizeUsername(bundle.username);
  if (!Number.isSafeInteger(bundle.keyVersion) || bundle.keyVersion < 1 ||
      !Number.isSafeInteger(bundle.signedPrekeyId) || bundle.signedPrekeyId < 0 ||
      bundle.identitySigningPublicKey.byteLength !== 32 || bundle.identityDhPublicKey.byteLength !== 32 ||
      bundle.signedPrekey.byteLength !== 32 || bundle.signedPrekeySignature.byteLength !== 64 ||
      (bundle.oneTimePrekey === undefined) !== (bundle.oneTimePrekeyId === undefined) ||
      (bundle.oneTimePrekeyId !== undefined && (!Number.isSafeInteger(bundle.oneTimePrekeyId) || bundle.oneTimePrekeyId < 0)) ||
      (bundle.oneTimePrekey !== undefined && bundle.oneTimePrekey.byteLength !== 32)) {
    throw invalidEnvelope("Invalid public prekey bundle.");
  }
}

/** Verifies signed prekeys before accepting public registration material. */
export class IdentityService {
  constructor(private readonly identities: IdentityRepository, private readonly signatures: SignatureVerifier) {}

  async register(bundle: PublicPrekeyBundle): Promise<void> {
    assertBundle(bundle);
    if (!await this.signatures.verifyPublicKey(bundle.identitySigningPublicKey, bundle.signedPrekey, bundle.signedPrekeySignature))
      throw new ProtocolError(ErrorCode.INVALID_SIGNATURE, "The signed prekey signature is invalid.");
    if (await this.identities.findBundle(bundle.username))
      throw new Error("Username is permanently bound; use a signed key rotation.");
    await this.identities.saveIdentity(bundle);
  }

  async lookup(username: string, consumeOneTimePrekey = false): Promise<PublicPrekeyBundle> {
    const bundle = await this.identities.findBundle(normalizeUsername(username));
    if (!bundle) throw new Error("Recipient not found");
    if (!consumeOneTimePrekey) return bundle;
    const prekey = await this.identities.consumeOneTimePrekey(bundle.username);
    // Absence is allowed by X3DH; clients must be prepared for a no-OPK bundle.
    return prekey ? { ...bundle, oneTimePrekey: prekey.key, oneTimePrekeyId: prekey.keyId } :
      { ...bundle, oneTimePrekey: undefined, oneTimePrekeyId: undefined };
  }

  async activate(auth: VerifiedRequest): Promise<void> {
    // Repository replacement is the active-installation switch. It must happen only
    // after a successful signed request, never merely on a directory lookup.
    await this.identities.activateInstallation(auth.username, auth.installationId);
  }

  async rotate(currentUsername: string, rotation: SignedIdentityRotation): Promise<void> {
    const replacement = rotation.bundle;
    assertBundle(replacement);
    const username = normalizeUsername(currentUsername);
    if (replacement.username !== username) throw new ProtocolError(ErrorCode.INVALID_USERNAME, "Identity rotation cannot rename a username.");
    const current = await this.identities.findBundle(username);
    if (!current) throw new Error("Identity not found");
    if (replacement.keyVersion !== current.keyVersion + 1 ||
        !await this.signatures.verify(username, identityRotationBytes(replacement), rotation.signature))
      throw new ProtocolError(ErrorCode.INVALID_SIGNATURE, "Invalid identity rotation proof.");
    await this.identities.rotateIdentity(username, replacement);
  }
}

/**
 * Request verification consumes the server challenge only after every bound field and
 * signature checks. The repository's conditional UPDATE provides cross-process replay protection.
 */
export class RequestAuthenticator {
  constructor(private readonly challenges: ChallengeRepository, private readonly signatures: SignatureVerifier, private readonly now = () => Date.now()) {}

  async authenticate(challenge: Challenge, proof: SignedRequestProof, payloadHash: Uint8Array): Promise<VerifiedRequest> {
    const request = proof.request;
    const now = this.now();
    if (challenge.expiresAt <= now || request.expiresAt <= now) throw new ProtocolError(ErrorCode.CHALLENGE_EXPIRED, "Challenge expired.");
    if (request.version !== 1 || request.purpose !== challenge.purpose || request.method !== challenge.method ||
        request.route !== challenge.route || request.requestId !== challenge.id || request.requestId.length === 0 ||
        !isUuid(request.installationId) || !equalBytes(request.payloadHash, payloadHash))
      throw new ProtocolError(ErrorCode.INVALID_SIGNATURE, "Signed request does not match its challenge or payload.");
    if (!await this.signatures.verify(challenge.username, signingBytes(request), proof.signature))
      throw new ProtocolError(ErrorCode.INVALID_SIGNATURE, "Invalid request signature.");
    if (!await this.challenges.consume(challenge, now)) throw new ProtocolError(ErrorCode.CHALLENGE_USED, "Challenge was already used or expired.");
    return { username: challenge.username, installationId: request.installationId, requestId: request.requestId };
  }
}

export class MessagingService {
  constructor(private readonly identities: IdentityRepository, private readonly messages: MessageRepository) {}
  async send(auth: VerifiedRequest, envelope: DirectEnvelope): Promise<{ messageId: string; duplicate: boolean }> {
    if (!await this.identities.isActiveInstallation(auth.username, auth.installationId))
      throw new ProtocolError(ErrorCode.INSTALLATION_REPLACED, "This vault is no longer the active installation.");
    if (envelope.version !== 1 || !isUuid(envelope.idempotencyId) || envelope.recipient !== normalizeUsername(envelope.recipient) ||
        envelope.recipient === auth.username || !Number.isSafeInteger(envelope.recipientKeyVersion) || envelope.recipientKeyVersion < 1 ||
        !Number.isSafeInteger(envelope.sentAt) || envelope.sentAt < 0 || !envelope.ciphertext.byteLength || envelope.ciphertext.byteLength > MAX_MESSAGE_BYTES)
      throw invalidEnvelope("Invalid encrypted envelope.");
    const recipient = await this.identities.findBundle(envelope.recipient);
    if (!recipient || recipient.keyVersion !== envelope.recipientKeyVersion) throw invalidEnvelope("Recipient key version is unavailable.");
    return this.messages.append(envelope, auth.username);
  }
  list(auth: VerifiedRequest, cursor?: string, limit = 50): Promise<MessagePage> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw invalidEnvelope("Invalid message page limit.");
    return this.messages.listFor(auth.username, cursor, limit);
  }
  deleteConversation(auth: VerifiedRequest, conversationId: string): Promise<void> {
    if (!isUuid(conversationId)) throw invalidEnvelope("Invalid conversation identifier.");
    return this.messages.deleteFor(auth.username, conversationId);
  }
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let different = 0;
  for (let i = 0; i < a.byteLength; i += 1) different |= a[i]! ^ b[i]!;
  return different === 0;
}

/** Exact bytes that a socket sender must bind in its signature. */
export function signedEnvelopeBytes(envelope: DirectEnvelope): Uint8Array { return envelopeBytes(envelope); }

/** Stable signed input for an identity-key rotation; the username remains permanently bound. */
export function identityRotationBytes(bundle: PublicPrekeyBundle): Uint8Array {
  return canonicalCbor({ purpose: "identity-rotation", ...bundle });
}

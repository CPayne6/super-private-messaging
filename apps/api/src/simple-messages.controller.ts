import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, createPublicKey, verify } from "node:crypto";
import { DatabaseService } from "./database.module.js";
import { canonicalCbor, normalizeUsername, signingBytes, type SignedRequest } from "@spm/protocol";
import type {
  DeliveredMessage,
  NativeWebSocketServer,
} from "./native-websocket.js";

const bytes = (value: string) => new Uint8Array(Buffer.from(value, "base64"));
const base64 = (value: Buffer) => value.toString("base64");
const uuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

interface KeyEnvelope {
  username: string;
  keyVersion: number;
  ephemeralPublicKey: string;
  nonce: string;
  ciphertext: string;
}
interface CreateConversation {
  id: string;
  creator: string;
  participants: KeyEnvelope[];
}
interface SendMessage {
  sender: string;
  conversationId: string;
  nonce: string;
  ciphertext: string;
  sentAt: number;
}

@Controller("v1")
export class SimpleMessagesController {
  private realtime?: NativeWebSocketServer;
  private readonly usedRequestIds = new Map<string, number>();
  constructor(private readonly postgres: DatabaseService) {}
  setRealtime(realtime: NativeWebSocketServer): void {
    this.realtime = realtime;
  }

  private async authenticatedUsername(
    headers: Record<string, string | string[] | undefined>,
    method: string,
    route: string,
    payload: unknown,
  ): Promise<string> {
    const username = typeof headers["x-spm-username"] === "string" ? normalizeUsername(headers["x-spm-username"]) : "";
    const requestId = headers["x-spm-request-id"];
    const expiresAt = Number(headers["x-spm-expires-at"]);
    const signature = headers["x-spm-signature"];
    const payloadHash = headers["x-spm-payload-hash"];
    if (!username || typeof requestId !== "string" || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 60_000 || typeof signature !== "string" || typeof payloadHash !== "string")
      throw new UnauthorizedException("A valid signed request is required.");
    const hash = createHash("sha256").update(canonicalCbor(payload)).digest();
    if (payloadHash !== hash.toString("base64") || this.usedRequestIds.has(requestId))
      throw new UnauthorizedException("Invalid or replayed signed request.");
    const request: SignedRequest = { version: 1, purpose: "private-http", method, route, payloadHash: new Uint8Array(hash), expiresAt, installationId: "00000000-0000-4000-8000-000000000000", requestId };
    const result = await this.postgres.query("SELECT identity_signing_public_key FROM users WHERE username=$1", [username]);
    const key = result.rows[0]?.identity_signing_public_key as Buffer | undefined;
    if (!key || !verify(null, signingBytes(request), createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key]), format: "der", type: "spki" }), Buffer.from(signature, "base64")))
      throw new UnauthorizedException("Invalid request signature.");
    this.usedRequestIds.set(requestId, expiresAt);
    for (const [id, expiry] of this.usedRequestIds) if (expiry <= Date.now()) this.usedRequestIds.delete(id);
    return username;
  }

  @Post("users") async register(
    @Body()
    body: {
      username: string;
      identityDhPublicKey: string;
      identitySigningPublicKey: string;
    },
  ) {
    const username = normalizeUsername(body.username),
      dh = bytes(body.identityDhPublicKey),
      signing = bytes(body.identitySigningPublicKey);
    if (dh.byteLength !== 32 || signing.byteLength !== 32)
      throw new BadRequestException("Invalid public key.");
    const stored = await this.postgres.query(
      "INSERT INTO users(username,identity_signing_public_key,identity_dh_public_key) VALUES($1,$2,$3) ON CONFLICT(username) DO UPDATE SET username=excluded.username WHERE users.identity_signing_public_key=excluded.identity_signing_public_key AND users.identity_dh_public_key=excluded.identity_dh_public_key RETURNING username",
      [username, Buffer.from(signing), Buffer.from(dh)],
    );
    if (!stored.rowCount)
      throw new ConflictException(
        "This username belongs to a different identity. Import its identity file instead of creating it again.",
      );
    return { username };
  }

  @Get("directory/:username") async directory(
    @Param("username") input: string,
  ) {
    const result = await this.postgres.query(
        "SELECT username,identity_signing_public_key,identity_dh_public_key,key_version FROM users WHERE username=$1",
        [normalizeUsername(input)],
      ),
      row = result.rows[0];
    if (!row) throw new NotFoundException("Recipient not found.");
    return {
      username: row.username,
      identitySigningPublicKey: base64(row.identity_signing_public_key),
      identityDhPublicKey: base64(row.identity_dh_public_key),
      keyVersion: row.key_version,
    };
  }

  @Post("conversations") async createConversation(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: Omit<CreateConversation, "creator">,
  ) {
    if (!uuid(body.id)) throw new BadRequestException("Invalid conversation ID.");
    if (!Array.isArray(body.participants))
      throw new BadRequestException("Conversation participants are missing.");
    if (body.participants.length < 2)
      throw new BadRequestException(
        `A conversation needs at least two participants (received ${body.participants.length}).`,
      );
    const creator = await this.authenticatedUsername(headers, "POST", "/v1/conversations", body),
      usernames = body.participants.map((item) =>
        normalizeUsername(item.username),
      );
    if (
      !usernames.includes(creator) ||
      new Set(usernames).size !== usernames.length
    )
      throw new BadRequestException("Invalid conversation participants.");
    for (const item of body.participants)
      if (
        !Number.isSafeInteger(item.keyVersion) ||
        item.keyVersion < 1 ||
        bytes(item.ephemeralPublicKey).byteLength !== 32 ||
        bytes(item.nonce).byteLength !== 12 ||
        bytes(item.ciphertext).byteLength <= 16
      )
        throw new BadRequestException("Invalid wrapped conversation key.");
    const client = await this.postgres.connect();
    try {
      await client.query("BEGIN");
      const users = await client.query(
        "SELECT username,key_version FROM users WHERE username = ANY($1)",
        [usernames],
      );
      if (
        users.rowCount !== usernames.length ||
        users.rows.some(
          (row) =>
            body.participants.find((item) => item.username === row.username)
              ?.keyVersion !== row.key_version,
        )
      )
        throw new BadRequestException("A participant identity is unavailable.");
      await client.query(
        "INSERT INTO conversations(id,created_by) VALUES($1,$2)",
        [body.id, creator],
      );
      for (const item of body.participants)
        await client.query(
          "INSERT INTO conversation_participants(conversation_id,username,key_version,ephemeral_public_key,key_nonce,wrapped_key) VALUES($1,$2,$3,$4,$5,$6)",
          [
            body.id,
            normalizeUsername(item.username),
            item.keyVersion,
            Buffer.from(bytes(item.ephemeralPublicKey)),
            Buffer.from(bytes(item.nonce)),
            Buffer.from(bytes(item.ciphertext)),
          ],
        );
      await client.query("COMMIT");
      return { id: body.id };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  @Get("conversations/:username") async conversations(
    @Param("username") input: string,
  ) {
    const username = normalizeUsername(input);
    const result = await this.postgres.query(
      "SELECT c.id, array_agg(all_members.username ORDER BY all_members.username) AS participants, own.key_version,own.ephemeral_public_key,own.key_nonce,own.wrapped_key FROM conversations c JOIN conversation_participants own ON own.conversation_id=c.id AND own.username=$1 JOIN conversation_participants all_members ON all_members.conversation_id=c.id GROUP BY c.id,own.key_version,own.ephemeral_public_key,own.key_nonce,own.wrapped_key ORDER BY c.created_at",
      [username],
    );
    return result.rows.map((row) => ({
      id: row.id,
      participants: row.participants,
      keyEnvelope: {
        username,
        keyVersion: row.key_version,
        ephemeralPublicKey: base64(row.ephemeral_public_key),
        nonce: base64(row.key_nonce),
        ciphertext: base64(row.wrapped_key),
      },
    }));
  }

  @Post("messages") async send(@Body() body: SendMessage) {
    const sender = normalizeUsername(body.sender);
    if (
      !uuid(body.conversationId) ||
      !Number.isSafeInteger(body.sentAt) ||
      bytes(body.nonce).byteLength !== 12 ||
      bytes(body.ciphertext).byteLength <= 16
    )
      throw new BadRequestException("Invalid encrypted message.");
    const members = await this.postgres.query(
      "SELECT username FROM conversation_participants WHERE conversation_id=$1",
      [body.conversationId],
    );
    if (!members.rows.some((row) => row.username === sender))
      throw new BadRequestException(
        "Sender is not a conversation participant.",
      );
    const id = crypto.randomUUID();
    await this.postgres.query(
      "INSERT INTO conversation_messages(id,conversation_id,sender,ciphertext,nonce,sent_at) VALUES($1,$2,$3,$4,$5,to_timestamp($6/1000.0))",
      [
        id,
        body.conversationId,
        sender,
        Buffer.from(bytes(body.ciphertext)),
        Buffer.from(bytes(body.nonce)),
        body.sentAt,
      ],
    );
    const message = {
      id,
      conversationId: body.conversationId,
      sender,
      ciphertext: body.ciphertext,
      nonce: body.nonce,
      sentAt: body.sentAt,
    } satisfies DeliveredMessage;
    members.rows.forEach((row) =>
      this.realtime?.publish(row.username, message),
    );
    return { message };
  }

  @Get("messages/:username") async messages(
    @Param("username") input: string,
  ): Promise<DeliveredMessage[]> {
    const username = normalizeUsername(input);
    const result = await this.postgres.query(
      "SELECT m.id,m.conversation_id,m.sender,m.ciphertext,m.nonce,m.sent_at FROM conversation_messages m JOIN conversation_participants p ON p.conversation_id=m.conversation_id WHERE p.username=$1 ORDER BY m.sent_at,m.id",
      [username],
    );
    return result.rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      sender: row.sender,
      ciphertext: base64(row.ciphertext),
      nonce: base64(row.nonce),
      sentAt: new Date(row.sent_at).getTime(),
    }));
  }
}

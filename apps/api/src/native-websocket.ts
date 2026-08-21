import { createPublicKey, verify } from "node:crypto";
import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { normalizeUsername, websocketChallengeBytes } from "@spm/protocol";
import type { DatabaseService } from "./database.module.js";
import type { RuntimeConfig } from "./config.js";

export interface DeliveredMessage {
  id: string;
  conversationId: string;
  sender: string;
  sentAt: number;
  nonce: string;
  ciphertext: string;
}

interface PendingAuthentication {
  username: string;
  nonce: Uint8Array;
  expiresAt: number;
}

const CHALLENGE_TTL_MS = 60_000;
const text = new TextDecoder();
const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const fromBase64 = (value: string) =>
  new Uint8Array(Buffer.from(value, "base64"));

/** Native WebSocket delivery with an Ed25519 challenge-response handshake. */
export class NativeWebSocketServer {
  private readonly server = new WebSocketServer({ noServer: true });
  private readonly sockets = new Map<string, Set<WebSocket>>();
  private readonly pending = new WeakMap<WebSocket, PendingAuthentication>();
  private readonly authenticated = new WeakMap<WebSocket, string>();

  constructor(
    httpServer: Server,
    private readonly postgres: DatabaseService,
    config: RuntimeConfig,
  ) {
    httpServer.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname !== "/ws") return;
      const origin = request.headers.origin;
      if (origin && !config.allowedOrigins.includes(origin)) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
      this.server.handleUpgrade(request, socket, head, (client) =>
        this.attach(client),
      );
    });
  }

  publish(username: string, message: DeliveredMessage): void {
    const payload = JSON.stringify({ type: "message", message });
    for (const socket of this.sockets.get(username) ?? []) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
  }

  private attach(socket: WebSocket): void {
    socket.on("message", (data) => void this.receive(socket, data));
    socket.on("close", () => this.remove(socket));
    socket.on("error", () => this.remove(socket));
  }

  private async receive(
    socket: WebSocket,
    data: Buffer | ArrayBuffer | Buffer[],
  ): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(text.decode(data as Buffer));
    } catch {
      return this.close(socket, "Malformed WebSocket message.");
    }
    if (!message || typeof message !== "object")
      return this.close(socket, "Malformed WebSocket message.");
    const input = message as Record<string, unknown>;
    if (
      !this.authenticated.has(socket) &&
      input.type === "identify" &&
      typeof input.username === "string"
    ) {
      await this.issueChallenge(socket, input.username);
      return;
    }
    if (!this.authenticated.has(socket) && input.type === "authenticate") {
      await this.authenticate(socket, input);
      return;
    }
    this.close(socket, "WebSocket is already authenticated.");
  }

  private async issueChallenge(
    socket: WebSocket,
    input: string,
  ): Promise<void> {
    let username: string;
    try {
      username = normalizeUsername(input);
    } catch {
      return this.close(socket, "Invalid username.");
    }
    const exists = await this.postgres.query(
      "SELECT 1 FROM users WHERE username=$1",
      [username],
    );
    if (!exists.rowCount) return this.close(socket, "Unknown identity.");
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const expiresAt = Date.now() + CHALLENGE_TTL_MS;
    this.pending.set(socket, { username, nonce, expiresAt });
    socket.send(
      JSON.stringify({ type: "challenge", nonce: toBase64(nonce), expiresAt }),
    );
  }

  private async authenticate(
    socket: WebSocket,
    input: Record<string, unknown>,
  ): Promise<void> {
    const pending = this.pending.get(socket);
    if (!pending || pending.expiresAt <= Date.now())
      return this.close(socket, "WebSocket challenge expired.");
    if (
      input.username !== pending.username ||
      input.nonce !== toBase64(pending.nonce) ||
      typeof input.signature !== "string"
    )
      return this.close(socket, "Invalid WebSocket challenge response.");
    const result = await this.postgres.query(
      "SELECT identity_signing_public_key FROM users WHERE username=$1",
      [pending.username],
    );
    const publicKey = result.rows[0]?.identity_signing_public_key as
      | Buffer
      | undefined;
    if (
      !publicKey ||
      !verify(
        null,
        websocketChallengeBytes(
          pending.username,
          pending.nonce,
          pending.expiresAt,
        ),
        createPublicKey({
          key: Buffer.concat([
            Buffer.from("302a300506032b6570032100", "hex"),
            publicKey,
          ]),
          format: "der",
          type: "spki",
        }),
        fromBase64(input.signature),
      )
    )
      return this.close(socket, "Invalid WebSocket signature.");
    this.pending.delete(socket);
    this.authenticated.set(socket, pending.username);
    const userSockets =
      this.sockets.get(pending.username) ?? new Set<WebSocket>();
    userSockets.add(socket);
    this.sockets.set(pending.username, userSockets);
    socket.send(JSON.stringify({ type: "authenticated" }));
  }

  private remove(socket: WebSocket): void {
    const username = this.authenticated.get(socket);
    if (!username) return;
    const userSockets = this.sockets.get(username);
    userSockets?.delete(socket);
    if (userSockets?.size === 0) this.sockets.delete(username);
  }

  private close(socket: WebSocket, reason: string): void {
    socket.close(1008, reason);
  }
}

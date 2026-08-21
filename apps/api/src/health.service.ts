import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "./database.module.js";
import { REDIS } from "./tokens.js";
export interface RedisHealthClient { ping(): Promise<string>; quit(): Promise<string>; }
@Injectable()
export class HealthService {
  private accepting = true;
  constructor(private readonly postgres: DatabaseService, @Inject(REDIS) private readonly redis: RedisHealthClient) {}
  live(): boolean { return true; }
  async ready(): Promise<boolean> { if (!this.accepting) return false; try { await Promise.all([this.postgres.query("SELECT 1"), this.redis.ping()]); return true; } catch { return false; } }
  stopAccepting(): void { this.accepting = false; }
}

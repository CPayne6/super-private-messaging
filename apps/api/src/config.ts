import { readFileSync } from "node:fs";

export interface RuntimeConfig { port: number; databaseUrl: string; redisUrl: string; allowedOrigins: readonly string[]; trustProxy: boolean; production: boolean; }

function valueFromEnvironment(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  if (value) return value;
  const file = env[`${name}_FILE`];
  if (!file) return undefined;
  return readFileSync(file, "utf8").trim();
}

export function runtimeConfig(env = process.env): RuntimeConfig {
  const port = Number(env.PORT ?? 8010);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port.");
  const databaseUrl = valueFromEnvironment(env, "DATABASE_URL");
  const redisUrl = valueFromEnvironment(env, "REDIS_URL");
  if (!databaseUrl || !redisUrl) throw new Error("DATABASE_URL and REDIS_URL are required.");
  const production = env.NODE_ENV === "production";
  const allowedOrigins = (valueFromEnvironment(env, "ALLOWED_ORIGINS") ?? "http://localhost:3010").split(",").map((value) => value.trim()).filter(Boolean);
  if (!allowedOrigins.length) throw new Error("ALLOWED_ORIGINS must contain at least one origin.");
  return { port, databaseUrl, redisUrl, allowedOrigins, trustProxy: env.TRUST_PROXY === "true", production };
}

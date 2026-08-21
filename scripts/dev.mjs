import { spawnSync } from "node:child_process";

function run(args) {
  return spawnSync("docker", args, { stdio: "inherit" });
}

const compose = spawnSync("docker", ["compose", "version"], { stdio: "ignore" });
if (compose.error || compose.status !== 0) {
  console.error("Docker Compose v2 is required. Install the Docker Compose CLI plugin, then rerun pnpm dev.");
  process.exit(1);
}

const result = run(["compose", "-f", "docker-compose.dev.yml", "up", "--build", "--wait", ...process.argv.slice(2)]);

if (result.error) {
  console.error(`Unable to run Docker: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  console.error("\nStartup failed. Current service status and dependency logs follow:");
  run(["compose", "-f", "docker-compose.dev.yml", "ps", "--all"]);
  run(["compose", "-f", "docker-compose.dev.yml", "logs", "--tail=100", "api", "web", "migrate", "postgres", "redis"]);
}

process.exit(result.status ?? 1);

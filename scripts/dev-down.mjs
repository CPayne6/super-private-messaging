import { spawnSync } from "node:child_process";

const services = process.argv.slice(2);
const args = services.length
  ? ["compose", "-f", "docker-compose.dev.yml", "rm", "--stop", "--force", ...services]
  : ["compose", "-f", "docker-compose.dev.yml", "down", "--remove-orphans"];

const result = spawnSync("docker", args, { stdio: "inherit" });

if (result.error) {
  console.error(`Unable to run Docker: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);

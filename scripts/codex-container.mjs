import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repository = resolve(import.meta.dirname, "..");
const image = "super-private-messaging-codex:local";
const dockerfile = resolve(repository, ".devcontainer", "Dockerfile");
const buildContext = resolve(repository, ".devcontainer");
const authFile = resolve(homedir(), ".codex", "auth.json");

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    console.error(`Unable to run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("docker", ["build", "--tag", image, "--file", dockerfile, buildContext]);

const args = [
  "run",
  "--rm",
  "--init",
  "--workdir",
  "/workspace/super-private-messaging",
  "--mount",
  `type=bind,src=${repository},dst=/workspace/super-private-messaging`,
];

if (process.stdin.isTTY && process.stdout.isTTY) args.push("--interactive", "--tty");

if (existsSync(authFile)) {
  args.push("--mount", `type=bind,src=${authFile},dst=/home/node/.codex/auth.json,readonly`);
} else {
  console.warn(`Codex authentication was not found at ${authFile}. Sign in with Codex on the host first, then rerun this command.`);
  process.exit(1);
}

args.push(image, "codex", "--yolo", ...process.argv.slice(2));
run("docker", args);

import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repository = resolve(import.meta.dirname, "..");
const image = "super-private-messaging-codex:local";
const dockerfile = resolve(repository, ".devcontainer", "Dockerfile");
const buildContext = resolve(repository, ".devcontainer");
const codexDirectory = resolve(repository, ".codex");
const authFile = resolve(homedir(), ".codex", "auth.json");
const sshDirectory = resolve(homedir(), ".ssh");
const gitConfig = resolve(homedir(), ".gitconfig");
const dockerSocket = "/var/run/docker.sock";
const ghConfigDirectory = "/home/node/.codex/gh";

function stageGitCredentials() {
  const directory = mkdtempSync(resolve(tmpdir(), "spm-codex-git-"));
  chmodSync(directory, 0o700);
  if (existsSync(sshDirectory)) {
    const stagedSsh = resolve(directory, ".ssh");
    cpSync(sshDirectory, stagedSsh, { recursive: true });
    chmodSync(stagedSsh, 0o700);
    for (const entry of ["config", "id_ed25519", "id_ed25519.pub", "known_hosts"]) {
      const file = resolve(stagedSsh, entry);
      if (existsSync(file)) chmodSync(file, entry === "id_ed25519" ? 0o600 : 0o644);
    }
  }
  if (existsSync(gitConfig)) {
    const stagedConfig = resolve(directory, ".gitconfig");
    cpSync(gitConfig, stagedConfig);
    chmodSync(stagedConfig, 0o600);
  }
  return directory;
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    console.error(`Unable to run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("docker", ["build", "--tag", image, "--file", dockerfile, buildContext]);

if (process.platform !== "win32" && !existsSync(dockerSocket)) {
  console.error(`Docker is running but its socket was not found at ${dockerSocket}. Start the Docker daemon on the host, then rerun this command.`);
  process.exit(1);
}

// This directory is bind-mounted into the otherwise ephemeral container so
// repository-specific Codex settings, sessions, and local state survive runs.
mkdirSync(codexDirectory, { recursive: true });

const args = [
  "run",
  "--rm",
  "--init",
  "--workdir",
  "/workspace/super-private-messaging",
  "--mount",
  `type=bind,src=${repository},dst=/workspace/super-private-messaging`,
  "--mount",
  `type=bind,src=${codexDirectory},dst=/home/node/.codex`,
];

args.push("--mount", `type=bind,src=${dockerSocket},dst=${dockerSocket}`);
// Keep GitHub CLI authentication inside the persisted Codex directory. This
// works consistently across host platforms (including Windows Credential
// Manager) and lets `gh auth login` inside Codex survive future runs.
args.push("--env", `GH_CONFIG_DIR=${ghConfigDirectory}`);
if (process.platform === "win32") {
  // Docker Desktop's proxy socket is root:root with group read/write access.
  args.push("--group-add", "0");
} else {
  // Socket permissions are based on the host's numeric group ID. Adding that
  // group at runtime keeps the image portable across Linux hosts.
  const socketGroup = spawnSync("stat", ["-c", "%g", dockerSocket], { encoding: "utf8" });
  if (socketGroup.status === 0 && /^\d+$/.test(socketGroup.stdout.trim())) {
    args.push("--group-add", socketGroup.stdout.trim());
  }
}

if (process.stdin.isTTY && process.stdout.isTTY) args.push("--interactive", "--tty");

if (existsSync(authFile)) {
  args.push("--mount", `type=bind,src=${authFile},dst=/home/node/.codex/auth.json,readonly`);
} else {
  console.warn(`Codex authentication was not found at ${authFile}. Sign in with Codex on the host first, then rerun this command.`);
  process.exit(1);
}

// OpenSSH rejects bind mounts that retain permissive host file modes. Stage a
// temporary owner-only copy and remove it immediately after Codex exits.
const gitCredentials = stageGitCredentials();
if (existsSync(resolve(gitCredentials, ".ssh"))) args.push("--mount", `type=bind,src=${resolve(gitCredentials, ".ssh")},dst=/home/node/.ssh,readonly`);
if (existsSync(resolve(gitCredentials, ".gitconfig"))) args.push("--mount", `type=bind,src=${resolve(gitCredentials, ".gitconfig")},dst=/home/node/.gitconfig,readonly`);
// Verify that the Codex process can reach the Docker daemon before it starts.
args.push(
  image,
  "sh",
  "-lc",
  "if ! command -v docker >/dev/null || ! command -v gh >/dev/null; then echo 'Docker or GitHub CLI is unavailable in the Codex container. Rebuild the local Codex image.' >&2; exit 1; fi; if ! docker version >/dev/null; then echo 'Codex cannot reach the Docker daemon. Start Docker Desktop and ensure its socket or Windows bridge is available.' >&2; exit 1; fi; exec codex --yolo \"$@\"",
  "--",
  ...process.argv.slice(2)
);
const result = spawnSync("docker", args, { stdio: "inherit" });
rmSync(gitCredentials, { recursive: true, force: true });
if (result.error) {
  console.error(`Unable to run docker: ${result.error.message}`);
  process.exitCode = 1;
} else if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
}

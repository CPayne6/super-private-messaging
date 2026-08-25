# Docker access from the Codex container

The Codex development image contains only the Docker client. The launcher
mounts the host daemon socket and adds the socket's numeric group to the
container process, so `docker` and `docker compose` work without running a
second privileged daemon.

Start Docker on the host, then launch Codex through `pnpm codex`. Docker socket
access is equivalent to privileged host access; use it only for trusted local
repositories. In a Dev Container, rebuild the container after this change so
the Docker CLI and `/var/run/docker.sock` mount take effect.

`pnpm codex` bind-mounts the host GitHub CLI configuration read-only at
`/home/node/.config/gh`. It supports the normal Linux location
(`~/.config/gh`), an explicit `GH_CONFIG_DIR`, and the Windows location
(`%APPDATA%\\GitHub CLI`). Run `gh auth login` on the host; refreshed host
credentials are immediately visible inside an already-running Codex container.
Rebuild the Dev Container to use its matching Windows GH CLI credential mount.

On Windows, GitHub CLI may keep its token in Credential Manager rather than in
the mounted configuration directory. Before opening the Dev Container, set a
session-only host environment variable in PowerShell:

```powershell
$env:GH_TOKEN = gh auth token
```

Rebuild/reopen the Dev Container, then run `pnpm codex`. The token is forwarded
only as a runtime environment variable; it is not written to the repository,
the image, or Codex state.

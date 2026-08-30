# Docker access from the Codex container

The Codex development image contains only the Docker client. The launcher
mounts the host daemon socket and adds the socket's numeric group to the
container process, so `docker` and `docker compose` work without running a
second privileged daemon.

Start Docker on the host, then launch Codex through `pnpm codex`. Docker socket
access is equivalent to privileged host access; use it only for trusted local
repositories. In a Dev Container, rebuild the container after this change so
the Docker CLI and `/var/run/docker.sock` mount take effect.
`pnpm codex` keeps GitHub CLI credentials in `.codex/gh` within this project.
That directory is mounted into the disposable container at
`/home/node/.codex/gh`, so credentials persist across future launches without
depending on the host operating system's credential store. From a Codex session
or `pnpm codex` shell, run `gh auth login` once. Do not run it with elevated
permissions: `.codex/gh` is deliberately ignored by Git.

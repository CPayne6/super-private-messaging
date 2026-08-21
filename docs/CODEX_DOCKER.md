# Docker access from the Codex container

The Codex development image contains only the Docker client. The launcher
mounts the host daemon socket and adds the socket's numeric group to the
container process, so `docker` and `docker compose` work without running a
second privileged daemon.

Start Docker on the host, then launch Codex through `pnpm codex`. Docker socket
access is equivalent to privileged host access; use it only for trusted local
repositories. In a Dev Container, rebuild the container after this change so
the Docker CLI and `/var/run/docker.sock` mount take effect.

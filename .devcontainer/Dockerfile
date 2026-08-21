FROM docker:29-cli AS docker-cli

FROM mcr.microsoft.com/devcontainers/typescript-node:latest

# Docker is deliberately the client only: the host Docker daemon is exposed via
# /var/run/docker.sock at runtime. Do not run Docker-in-Docker for this project.
USER root
ARG DOCKER_COMPOSE_VERSION=v5.1.2
RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates curl \
  && architecture="$(dpkg --print-architecture)" \
  && case "$architecture" in amd64) compose_architecture=x86_64 ;; arm64) compose_architecture=aarch64 ;; *) echo "Unsupported Docker Compose architecture: $architecture" >&2; exit 1 ;; esac \
  && mkdir -p /usr/local/lib/docker/cli-plugins \
  && curl --fail --location --silent --show-error "https://github.com/docker/compose/releases/download/${DOCKER_COMPOSE_VERSION}/docker-compose-linux-${compose_architecture}" --output /usr/local/lib/docker/cli-plugins/docker-compose \
  && chmod +x /usr/local/lib/docker/cli-plugins/docker-compose \
  && rm -rf /var/lib/apt/lists/*
RUN apt-get update \
  && curl --fail --location --silent --show-error https://cli.github.com/packages/githubcli-archive-keyring.gpg --output /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install --yes --no-install-recommends gh \
  && npm install --global pnpm@10 @openai/codex@latest \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /home/node/.codex \
  && chown node:node /home/node/.codex

# Copy the Docker CLI from the official CLI image. The Debian docker.io package
# in this base image does not provide the client executable.
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker

USER node

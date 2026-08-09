FROM mcr.microsoft.com/devcontainers/typescript-node:latest

# Install pnpm and the Codex CLI. The devcontainer configuration mounts Codex
# authentication from the host.
RUN npm install --global pnpm@10 @openai/codex@latest \
  && mkdir -p /home/node/.codex \
  && chown node:node /home/node/.codex

USER node

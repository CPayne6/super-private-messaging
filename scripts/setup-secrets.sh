#!/usr/bin/env bash
set -euo pipefail

# Creates the Swarm secrets used by docker-compose.prod.yml. Existing secrets
# are deliberately left untouched: Swarm cannot remove a secret in use by a
# service, and silently rotating one could leave the stack inconsistent.
DEPLOY_HOST="${DEPLOY_HOST:?Set DEPLOY_HOST to an SSH host or hostname}"
ENV_FILE="${ENV_FILE:-deploy/.env.production}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Start with deploy/.env.production.example." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

declare -A secrets=(
  [spm_postgres_password]="${POSTGRES_PASSWORD:?}"
  [spm_app_password]="${POSTGRES_APP_PASSWORD:?}"
  [spm_database_url]="${DATABASE_URL:?}"
  [spm_redis_password]="${REDIS_PASSWORD:?}"
  [spm_redis_url]="${REDIS_URL:?}"
  [spm_allowed_origins]="${ALLOWED_ORIGINS:?}"
  [spm_cloudflare_tunnel_token]="${CLOUDFLARE_TUNNEL_TOKEN:?}"
)

ssh "$DEPLOY_HOST" "docker info --format '{{.Swarm.LocalNodeState}}'" | grep -qx active || {
  echo "Docker Swarm is not active on $DEPLOY_HOST. Run: docker swarm init" >&2
  exit 1
}

for name in "${!secrets[@]}"; do
  if ssh "$DEPLOY_HOST" "docker secret inspect '$name' >/dev/null 2>&1"; then
    echo "Keeping existing secret: $name"
  else
    printf '%s' "${secrets[$name]}" | ssh "$DEPLOY_HOST" "docker secret create '$name' - >/dev/null"
    echo "Created secret: $name"
  fi
done

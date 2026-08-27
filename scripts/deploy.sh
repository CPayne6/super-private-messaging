#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/deploy/super-private-messaging}"
STACK_NAME="${STACK_NAME:-spm}"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.prod.yml"
IMAGE_TAG="${IMAGE_TAG:-latest}"
GITHUB_REPOSITORY_OWNER="${GITHUB_REPOSITORY_OWNER:?Set GITHUB_REPOSITORY_OWNER}"

required_secrets=(
  spm_postgres_password spm_app_password
  spm_database_url spm_redis_password spm_redis_url spm_allowed_origins
  spm_cloudflare_tunnel_token
)
for secret in "${required_secrets[@]}"; do
  docker secret inspect "$secret" >/dev/null 2>&1 || {
    echo "Missing Docker secret: $secret. Run scripts/setup-secrets.sh first." >&2
    exit 1
  }
done

for image in api migrate web; do
  image_ref="ghcr.io/$GITHUB_REPOSITORY_OWNER/super-private-messaging-$image:$IMAGE_TAG"
  if ! docker pull "$image_ref"; then
    # Preserve the ScoutLGS deployment behavior: Swarm receives the registry
    # credentials below and can retry the pull when it schedules the update.
    # This also permits a deploy when the image is already cached locally.
    echo "Warning: failed to pre-pull $image_ref; Swarm will retry during stack deployment" >&2
  fi
done

# Pre-pull public runtime images too. A Swarm task can otherwise remain in
# `Preparing` without surfacing a registry error through `docker service ps`.
for image_ref in postgres:17-alpine redis:7.4-alpine cloudflare/cloudflared:2026.8.1; do
  docker pull "$image_ref"
done

cd "$PROJECT_DIR"
export IMAGE_TAG GITHUB_REPOSITORY_OWNER
# Submit the stack first, then use the bounded checks below for actionable
# service diagnostics. `--detach=false` can wait indefinitely for a failed
# task without ever printing its status.
docker stack deploy --with-registry-auth --detach=true -c "$COMPOSE_FILE" "$STACK_NAME"

wait_for_running() {
  local service="$1"
  for _ in $(seq 1 30); do
    if docker service ps "${STACK_NAME}_${service}" --filter desired-state=running --format '{{.CurrentState}}' | grep -q '^Running'; then
      return 0
    fi
    sleep 4
  done
  docker service ps "${STACK_NAME}_${service}" --no-trunc >&2 || true
  local task_ids
  task_ids="$(docker service ps -q "${STACK_NAME}_${service}" 2>/dev/null || true)"
  if [[ -n "$task_ids" ]]; then
    # Include Swarm's scheduler/pull/volume error, even when no container was
    # started and service logs are therefore unavailable.
    docker inspect $task_ids >&2 || true
  fi
  docker node inspect self --format '{{json .Description.Resources}}' >&2 || true
  return 1
}

wait_for_running postgres
wait_for_running redis

# A forced run ensures forward-only migrations are evaluated on every deploy.
docker service update --force "${STACK_NAME}_migrate" >/dev/null
for _ in $(seq 1 30); do
  state="$(docker service ps "${STACK_NAME}_migrate" --no-trunc --format '{{.CurrentState}}' | head -1)"
  if [[ "$state" == Complete* ]]; then break; fi
  if [[ "$state" == Failed* || "$state" == Rejected* ]]; then
    docker service ps "${STACK_NAME}_migrate" --no-trunc >&2
    exit 1
  fi
  sleep 4
done
[[ "${state:-}" == Complete* ]] || { echo "Migration did not complete" >&2; exit 1; }

wait_for_running api
wait_for_running web
wait_for_running cloudflared
docker stack services "$STACK_NAME"

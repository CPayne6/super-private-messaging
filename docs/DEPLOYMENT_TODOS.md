# Production deployment checklist

This checklist covers the remaining work to launch the Docker Swarm deployment
defined in `docker-compose.prod.yml`.

## 1. Server foundation

- [x] Provision a small Linux server with Docker Engine installed.
- [x] Create a dedicated, non-root `deploy` user with Docker access.
- [x] Initialize single-node Swarm mode: `docker swarm init`.
- [x] Create `/home/deploy/super-private-messaging` and make it owned by the
  deploy user.
- [x] Log Docker in to GHCR on the server, using an account or fine-grained
  token that can pull this repository's packages.
- [x] Refresh the server's existing GHCR Docker login and grant it package-read
  access to both the ScoutLGS and VaultChat packages; verify authenticated
  pulls of `ghcr.io/cpayne6/scoutlgs-scraper:production` and the VaultChat API
  image before rerunning the production workflow.
- [x] Confirm the server has persistent disk capacity for PostgreSQL backups
  and Docker volumes.

## 2. Dedicated deployment access

- [x] Add `C:\Users\cpayn\.ssh\spm_deploy_key.pub` to the server deploy user's
  `~/.ssh/authorized_keys`.
- [ ] Add the `spm-prod` SSH host entry from `docs/PRODUCTION.md` to the local
  SSH configuration.
- [ ] Verify the isolated key works: `ssh spm-prod 'docker info'`.
- [ ] Store the private key from `C:\Users\cpayn\.ssh\spm_deploy_key` as the
  GitHub `production` environment secret `DEPLOY_SSH_KEY`.
- [ ] Add `DEPLOY_HOST`, `DEPLOY_USER`, and `DEPLOY_PROJECT_DIR` to the same
  GitHub environment.

## 3. Domain and public ingress

- [ ] Create a Cloudflare Tunnel for this application.
- [ ] Configure its public hostname to route to `http://web:8080`.
- [ ] Set the final public URL in `ALLOWED_ORIGINS`; include no development
  origins in the production value.
- [ ] Verify Cloudflare SSL/TLS is set to Full (strict) and HTTPS redirects are
  enabled.

## 4. Production secrets

- [x] Copy `deploy/.env.production.example` to `deploy/.env.production` on a
  trusted workstation; do not commit it.
- [x] Generate unique, high-entropy PostgreSQL, application-role, and Redis
  passwords.
- [x] Set `DATABASE_URL` and `REDIS_URL` with correctly URL-encoded passwords.
- [x] Add the Cloudflare Tunnel token and final allowed origin.
- [x] Create the Swarm secrets:
  `DEPLOY_HOST=spm-prod bash scripts/setup-secrets.sh`.
- [x] Confirm `docker secret ls` on the server lists all `spm_*` secrets.

## 5. First deployment

- [ ] Push the repository to GitHub and ensure GitHub Container Registry is
  enabled for it.
- [ ] Push to the `production` branch, or manually run the **Build and deploy**
  workflow.
- [ ] Confirm the workflow has published API, web, and migration images.
- [ ] Confirm `docker stack services spm` shows healthy running services.
- [ ] Check the migration service's latest task completed successfully:
  `docker service ps spm_migrate --no-trunc`.
- [ ] Visit the public URL and verify login-free messaging flows, `/api/health/ready`,
  and WebSocket connectivity.

## 6. Operational readiness

- [ ] Configure encrypted, off-server PostgreSQL backups and test a restore.
- [ ] Monitor disk use, container restarts, API health, Redis persistence, and
  Cloudflare Tunnel connectivity.
- [ ] Set alerts for failed migrations, failed API health checks, and database
  volume exhaustion.
- [ ] Document the secret-rotation procedure. Swarm secrets in use cannot be
  overwritten; rotation requires a planned stack update.
- [ ] Review the security launch requirements in `docs/PRODUCTION.md` and
  `docs/SECURITY.md`, including independent review of the browser crypto.

## 7. Capacity review after launch

- [ ] Observe actual CPU and memory use for at least a week.
- [ ] Keep the intentionally small current limits unless monitoring shows
  pressure: API/PostgreSQL 256 MiB, Redis 128 MiB, web/tunnel 64 MiB.
- [ ] Increase limits gradually and independently only for the service that
  demonstrates sustained pressure.

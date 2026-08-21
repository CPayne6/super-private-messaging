# Production operations

## Docker Swarm deployment

Production follows the MTG scraper deployment model: GHCR images are deployed
as a Docker Swarm stack, Docker secrets hold credentials, and a Cloudflare
Tunnel is the only public ingress. The small deployment limits the complete
stack to about 1 GiB RAM and 1 CPU at maximum; normal reservations total about
400 MiB and 0.4 CPU.

1. On the server, install Docker, run `docker swarm init`, create
   `/home/deploy/super-private-messaging`, and authenticate Docker to GHCR.
   Install the public half of this application's dedicated deployment key in
   the deploy user's `~/.ssh/authorized_keys`; do not reuse the MTG scraper
   key. On the workstation, add an SSH config entry such as:

   ```sshconfig
   Host spm-prod
     HostName your-server.example.com
     User deploy
     IdentityFile ~/.ssh/spm_deploy_key
     IdentitiesOnly yes
   ```

2. Copy `deploy/.env.production.example` to `deploy/.env.production`, replace
   every value, and point the Cloudflare tunnel's public hostname to
   `http://web:8080`.
3. From a trusted machine with SSH access, run
   `DEPLOY_HOST=spm-prod ./scripts/setup-secrets.sh`.
4. Copy `docker-compose.prod.yml` and `scripts/deploy.sh` to the server, then
   run `PROJECT_DIR=/home/deploy/super-private-messaging GITHUB_REPOSITORY_OWNER=OWNER IMAGE_TAG=production ./scripts/deploy.sh`.

The GitHub Actions workflow performs steps 3's deployment half automatically
for pushes to `production`. Configure its `production` environment with
`DEPLOY_HOST`, `DEPLOY_USER`, and `DEPLOY_SSH_KEY` secrets plus a
`DEPLOY_PROJECT_DIR` variable. The initial secret setup remains manual.
Set `DEPLOY_SSH_KEY` to the complete contents of `~/.ssh/spm_deploy_key` (the
private key), never the `.pub` file.

`migrate` is a short-lived Swarm service. The deploy script forces it on every
rollout and stops if forward-only database migrations do not finish before API
health is checked.

Use managed PostgreSQL and Redis on private networks, with TLS required by each
client where those services are external. Store application, migration, Redis,
and image-signing credentials in a secret manager; never place them in Compose
files or image layers.

Backups must be encrypted, access controlled, and restore-tested on a documented
schedule. Monitor readiness failures, migration failures, prekey exhaustion,
request errors, and WebSocket churn. Logs must remain structured and redact
authorization headers, IP addresses where not needed, ciphertext, signatures,
challenges, passphrases, and vault bytes.

This repository is not approved for public launch until its browser Signal
implementation is vetted and independently reviewed.

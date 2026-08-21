# Local development

Start the complete local stack:

```sh
cp .env.example .env
pnpm dev
```

`pnpm dev` uses `docker-compose.dev.yml`: the API runs in development mode and
the UI runs through Vite at `http://localhost:3010`. UI source changes are
bind-mounted and hot-reload in the browser. It reuses the same local services,
ports, and data volumes as `docker-compose.yml`, so the two configurations are
alternatives—not stacks to run at the same time. Use `pnpm dev:logs` to follow
the stack and `pnpm dev:down` to stop it.

`docker-compose.yml` remains the production-shaped local build: it serves the
compiled UI from Nginx and retains the runtime hardening settings. Start it
explicitly with `pnpm docker:up` when validating that image.

The local endpoints use the `X010` port convention:

- PostgreSQL: `localhost:5010` (`spm` / `spm_local_only`, database `spm`)
- Redis: `localhost:6010`

Versioned migrations run once through the `migrate` job. Local database and
Redis data live in named volumes; use `docker compose -f docker-compose.dev.yml down -v` only when you
intentionally want a clean local database.

The API is available at `http://localhost:8010` and the same-origin web UI at
`http://localhost:3010`. Run `pnpm docker:test` for the disposable test stack.

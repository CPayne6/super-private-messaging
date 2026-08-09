# Local development

Start the backing services:

```sh
docker compose up -d postgres redis
```

The local endpoints use the `X010` port convention:

- PostgreSQL: `localhost:5010` (`spm` / `spm_local_only`, database `spm`)
- Redis: `localhost:6010`

The PostgreSQL schema is installed from `apps/api/src/schema.sql` when the
database volume is first created. To apply it again from a clean database,
run `docker compose down -v` and start the services again.

Run repository commands in an ephemeral container with the service addresses
preconfigured:

```sh
docker compose --profile tools run --rm workspace pnpm build
docker compose --profile tools run --rm workspace pnpm test
```

The workspace presently contains protocol, API-domain, and browser-domain
libraries only; it does not yet define an HTTP or web-server process. When one
is added, expose its host port using the same `X010` suffix in
`docker-compose.yml`.

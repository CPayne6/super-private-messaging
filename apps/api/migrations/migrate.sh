#!/bin/sh
set -eu

: "${POSTGRES_DB:?}" "${POSTGRES_MIGRATION_USER:?}" "${POSTGRES_APP_USER:?}"
if [ -z "${POSTGRES_APP_PASSWORD:-}" ] && [ -z "${POSTGRES_APP_PASSWORD_FILE:-}" ]; then
  echo "POSTGRES_APP_PASSWORD or POSTGRES_APP_PASSWORD_FILE is required" >&2
  exit 1
fi
if [ -n "${POSTGRES_MIGRATION_PASSWORD_FILE:-}" ]; then
  PGPASSWORD=$(cat "$POSTGRES_MIGRATION_PASSWORD_FILE")
  export PGPASSWORD
fi
if [ -n "${POSTGRES_APP_PASSWORD_FILE:-}" ]; then
  POSTGRES_APP_PASSWORD=$(cat "$POSTGRES_APP_PASSWORD_FILE")
  export POSTGRES_APP_PASSWORD
fi
psql -h postgres -U "$POSTGRES_MIGRATION_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
  -c 'CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())'
for migration in /migrations/[0-9][0-9][0-9]_*.sql; do
  version=$(basename "$migration" .sql)
  if ! psql -h postgres -U "$POSTGRES_MIGRATION_USER" -d "$POSTGRES_DB" -tAc "SELECT 1 FROM schema_migrations WHERE version = '$version'" | grep -qx 1; then
    psql -h postgres -U "$POSTGRES_MIGRATION_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -f "$migration"
    psql -h postgres -U "$POSTGRES_MIGRATION_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "INSERT INTO schema_migrations(version) VALUES ('$version')"
  fi
done
psql -h postgres -U "$POSTGRES_MIGRATION_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -v app_user="$POSTGRES_APP_USER" -v app_password="$POSTGRES_APP_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'app_user') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'app_user') \gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app_user') \gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', :'app_user') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', :'app_user') \gexec
SQL

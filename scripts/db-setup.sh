#!/usr/bin/env bash
# Lokal PostgreSQL'da rollar va bazalarni yaratadi (superuser sifatida ishga tushiriladi).
# educrm_owner — migration'lar egasi; educrm_app — ilova roli: superuser emas, BYPASSRLS yo'q, jadval egasi emas (TZ 8.4).
set -euo pipefail
PSQL="psql -v ON_ERROR_STOP=1 -d postgres -Atq"

$PSQL <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'educrm_owner') THEN
    CREATE ROLE educrm_owner LOGIN PASSWORD 'educrm_owner' NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'educrm_app') THEN
    CREATE ROLE educrm_app LOGIN PASSWORD 'educrm_app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;
SQL

for db in educrm educrm_test; do
  if [ -z "$($PSQL -c "SELECT 1 FROM pg_database WHERE datname = '$db'")" ]; then
    $PSQL -c "CREATE DATABASE $db OWNER educrm_owner"
  fi
  psql -v ON_ERROR_STOP=1 -d "$db" -Atq <<'SQL'
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
GRANT USAGE ON SCHEMA public TO educrm_app;
ALTER SCHEMA public OWNER TO educrm_owner;
SQL
  echo "ok: $db"
done

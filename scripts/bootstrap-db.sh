#!/usr/bin/env bash
set -eu

if [ "$OWNER_USER" = "$APP_USER" ] || [ "$OWNER_USER" = "$PGUSER" ] || [ "$APP_USER" = "$PGUSER" ]; then
    echo "Bootstrap administrator, migration owner, and app user must be distinct." >&2
    exit 1
fi

psql --set=ON_ERROR_STOP=1 <<'SQL'
\getenv owner_user OWNER_USER
\getenv owner_password OWNER_PASSWORD
\getenv app_user APP_USER
\getenv app_password APP_PASSWORD
\getenv database PGDATABASE
BEGIN;
SELECT format('CREATE ROLE %I LOGIN', :'owner_user')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'owner_user') \gexec
SELECT format('CREATE ROLE %I LOGIN', :'app_user')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'app_user') \gexec
ALTER ROLE :"owner_user" WITH LOGIN NOSUPERUSER CREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'owner_password';
ALTER ROLE :"app_user" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'app_password';
ALTER DATABASE :"database" OWNER TO :"owner_user";
SET ROLE :"owner_user";
CREATE SCHEMA IF NOT EXISTS ssot AUTHORIZATION :"owner_user";
ALTER SCHEMA ssot OWNER TO :"owner_user";
REVOKE ALL ON SCHEMA ssot FROM PUBLIC;
REVOKE ALL ON SCHEMA ssot FROM :"app_user";
GRANT CONNECT ON DATABASE :"database" TO :"app_user";
GRANT USAGE ON SCHEMA ssot TO :"app_user";
COMMIT;
SQL

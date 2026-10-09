# ssot2026
Solo Somos Otros Tenaces 2026

# install

Keep the sibling `../system-definition` checkout available with its core and
`consumers/postgres-migrations` packages built. Dependencies use those local packages.

```sh
> npm install
> npm run build
> npm start
```

## Local PostgreSQL connection

Copy `.env.example` to `.env`, then run:

```sh
docker compose up -d --wait postgres
npm run db:bootstrap
npm run db:check
```

Compose runs PostgreSQL 18.6 on `127.0.0.1:5433` and keeps data in a named volume.
The backend uses `PGUSER`/`PGPASSWORD` for `ssot2026_user`. Migration work uses
`MIGRATION_PGUSER`/`MIGRATION_PGPASSWORD` for `ssot2026_owner`. The owner owns the
database and `ssot` schema; it has `CREATEDB` for temporary verification databases.
The app user is not an owner or superuser and cannot create databases or roles.
Docker's `POSTGRES_USER`/`POSTGRES_PASSWORD` are used only for bootstrap.

The backend commands load `.env`; existing environment variables take precedence.
`DATABASE_URL` overrides the app connection and `MIGRATION_DATABASE_URL` overrides
the migration connection. `db:check` checks both logins and PostgreSQL 18.6.
Bootstrap can be rerun on the existing Docker volume; it does not recreate the database.

If you used the earlier single-user `.env`, update it from `.env.example` before
bootstrap, retaining the administrator credentials used to initialize the volume.

Use `docker compose stop postgres` to stop it while retaining its data.

## Generate the initial migration

```sh
npm run migration:generate-initial
npm run test:initial-migration
```

The migration package generates the table DDL from `src/backend/system.ts`, verifies
it on a temporary PostgreSQL database using the owner login, then publishes an
immutable initial release under `migrations/releases/initial`. Review
`resources/create-tables.sql` and `resources/app-grants.sql` there. The release also
contains the SSOT snapshot, type mappings, hashes, and an ownership/permissions check.
The app grants allow SELECT, INSERT, UPDATE, and DELETE, matching the backend routes.

The integration test replays the published SQL and checks that the app can read and
write but cannot create or alter tables or assume the owner role. Temporary databases
are removed after verification. Generation does not apply tables to the app database.
The existing test-data inserts are not included: they conflict with the current SSOT.
Repeating generation with unchanged inputs reuses the release; changed inputs cannot
overwrite it. Future changes must be published as a new release.

## Capture the backend SSOT

```sh
npm run migration:capture
npm run migration:capture -- --out dist/system-snapshot.json
```

The command builds this backend and captures the records and entities from
`src/backend/system.ts` as JSON (`{ok, value}`). It does not connect to PostgreSQL
or modify the database.

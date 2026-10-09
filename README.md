# ssot2026
Solo Somos Otros Tenaces 2026

# install

Keep the sibling `../system-definition` checkout available. Docker builds its core
and migration packages along with this backend. Copy `.env.example` to `.env`, then:

```sh
docker compose up --build -d --wait
```

Open `http://localhost:3000/menu`. The entity lists are available at
`http://localhost:3000/poc/lista-materias` and `/poc/lista-pabellones`.
The initial tables start empty.

Compose waits for PostgreSQL, runs role bootstrap, installs/verifies the published
initial release as the owner, then starts the backend as the app user. The backend
container receives only the app credentials. Its health check queries PostgreSQL.
Repeated startup verifies the recorded baseline and schema and preserves existing rows.
Modified artifacts, schema drift, and untracked existing tables block installation.

Use `docker compose logs migration backend` to inspect startup failures.

## Run the backend on the host

Build the sibling packages and install this checkout's npm dependencies first.
With `.env` configured, run:

```sh
docker compose up -d --wait postgres
npm run db:bootstrap
npm run migration:install
npm start
```

Compose runs PostgreSQL 18.6 on `127.0.0.1:5433` and keeps data in a named volume.
The backend uses `PGUSER`/`PGPASSWORD` for `ssot2026_user`. Migration work uses
`MIGRATION_PGUSER`/`MIGRATION_PGPASSWORD` for `ssot2026_owner`. The owner owns the
database and `ssot` schema; it has `CREATEDB` for temporary verification databases.
The app user is not an owner or superuser and cannot create databases or roles.
Docker's `POSTGRES_USER`/`POSTGRES_PASSWORD` are used only for bootstrap.

The backend commands load `.env`; existing environment variables take precedence.
`DATABASE_URL` overrides the app connection and `MIGRATION_DATABASE_URL` overrides
the migration connection.
Bootstrap can be rerun on the existing Docker volume; it does not recreate the database.

Use `docker compose stop postgres` to stop it while retaining its data.

## Check the installed release

```sh
npm run migration:check
```

The command verifies artifact hashes, the backend SSOT, the recorded baseline,
database structure, and owner/app permissions. Installation uses the migration
library's advisory lock and journal. Table creation, grants, checks, and recording
the baseline are committed together; failures roll back and block backend startup.
The journal is owned by the migration owner and is inaccessible to the app user.
An existing database without a recorded baseline requires a separate adoption step.

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
Repeating generation with unchanged inputs reuses the release; changed inputs cannot
overwrite it. Future changes must be published as a new release.

# ssot2026

The backend defines its entities with `system-definition` in `src/backend/system.ts`.
It exports `ssot`, the model produced by the core's `captureSystemSnapshot`.
The migration package reads that value using the existing `SystemSnapshotInfo`
and `ValidationResult` types. The app needs no PostgreSQL-specific SSOT constructor.

## Load the SSOT

Build the sibling `system-definition` package and its PostgreSQL consumer, then
install this checkout's dependencies.

```sh
npm run ssot:load
npm run migration:load
npm run test:ssot
```

The command loads the app's exported model and validates it with the core decoder.
`migration:load` also reads `databaseSettings` from `src/backend/database.ts`:
the PostgreSQL connection settings and schema, the owner role, and the app role. The connection
uses the driver's existing `ClientConfig` type. The backend uses the same settings
with the app role. The loader requires distinct owner/app names; applying database
permissions is a later step. CLI output includes connection identity and role names.
The load commands do not connect to PostgreSQL. Schema assessment is a separate
read-only command. Bootstrap, permission setup, generation, and installation
will be handled separately. The previous automatic migration commands and Compose
initialization services have been removed.

## Assess schema differences

```sh
npm run migration:assess
npm run test:assessment
```

Assessment projects the SSOT into a PostgreSQL schema, reads the configured SQL
schema using the app connection, and compares normalized structures. It returns
`{equal, differences}`. Each difference has `path`, `change`, `before` (database),
and `after` (SSOT). This step reads catalogs and leaves tables and data unchanged.
Constraint backing indexes are represented by their constraints; independent
indexes remain visible as differences. Current mappings cover text, integer, and
boolean; unsupported domains produce a mapping error. Migration planning and
execution are separate steps.

The published initial release remains under `migrations/releases/initial`.
The SSOT test confirms that the current domain model matches its saved snapshot.

## Run the backend

```sh
docker compose up --build -d --wait
```

Compose runs PostgreSQL 18.6 and the backend. The backend connects as the app user
using `PGUSER`/`PGPASSWORD` or `DATABASE_URL`. This currently requires an existing
database with its roles and tables already provisioned, such as the current local
Docker volume. Fresh-volume database setup is outside this step.

For a host process, configure `.env`, start PostgreSQL, build, and run `npm start`.
PostgreSQL is exposed on `127.0.0.1:5433`; the Docker backend is on port 3000.

## API contract

`GET /health` checks the database connection. `GET /api/entities` returns the
available entity names. `GET /api/entities/:name` returns `{name, columns, rows}`,
with only `{name, label, type}` for each column. Unknown names return HTTP 404;
query failures or rows inconsistent with the SSOT return HTTP 500.

The types in `src/backend/api-contract.ts` derive field names, value types,
nullability, and primary keys from the backend definitions. Browser code can
import this contract with `import type`.

```sh
npm run test:api
```

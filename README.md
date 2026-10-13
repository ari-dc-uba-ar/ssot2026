# ssot2026

The backend defines its entities with `system-definition` in `src/backend/system.ts`.
It exports `ssot`, the model produced by the core's `captureSystemSnapshot`, and
`sqlMapping`, which explicitly maps every backend type to a supplied SQL type.
The mapping uses `sqlTypes` and `SqlTypeMapping<typeof ssot>` from `system-definition`.
Missing keys and unsupported choices fail typing; the migration loader also rejects
missing, extra or invalid mappings at runtime. The app needs no PostgreSQL-specific
SSOT constructor.

## Load the SSOT

Build the sibling `system-definition` package and its PostgreSQL consumer, then
install this checkout's dependencies.

```sh
npm run ssot:load
npm run migration:load
npm run test:ssot
```

The command loads the app's exported model and SQL mapping, using the core snapshot
and persistence decoders. It returns `{ssot, persistence}`.
`migration:load` also reads `databaseSettings` from `src/backend/database.ts`:
the PostgreSQL connection settings and schema, the initial provisioning connection,
the owner role, and the app role. The connection
uses the driver's existing `ClientConfig` type. The backend uses the same settings
with the app role. The loader requires distinct owner/app names. CLI output
includes connection identity and role names.
`initialUser` takes the driver's `ClientConfig` with a required username. The app
supplies it through `POSTGRES_USER`/`POSTGRES_PASSWORD`; its credentials are omitted
from CLI output. It is reserved for initial role and permission setup.
The load commands do not connect to PostgreSQL. Schema assessment is a separate
read-only command. The apply command provisions initial roles and permissions,
then executes migrations through the owner connection.

## Assess schema differences

```sh
npm run migration:assess
npm run test:assessment
```

Assessment projects the SSOT into a PostgreSQL schema, reads the configured SQL
schema using the app connection, and compares normalized structures. Inspection reads
the existing schema names and objects from a single catalog query, including empty
schemas. Comparison ignores object property order and preserves array order. It returns
`{equal, differences}`. Each difference has `path`, `change`, `before` (database),
and `after` (SSOT). This step reads catalogs and leaves tables and data unchanged.
Each difference also has `impact`: `preserving`, `requiresDataCheck`, `destructive`,
or `unsupported`. Classification reuses the assessment result and requires no
release/history configuration. Destructive changes require a user data decision;
data-sensitive changes require validation or a conversion/backfill decision.
Table removals group their children into one decision. Possible renames remain
removal plus addition until the user supplies an explicit correspondence.
Constraint backing indexes are represented by their constraints; independent
indexes remain visible as differences. Mapping comes from the backend's explicit
choices rather than defaults or TypeScript type inference. Migration planning and
execution are separate steps.

`generateMigrationSql(changes, current, target, schema)` renders resolved schema
changes with the loaded SSOT and its mapping. It reuses the existing SQL renderers
and returns ordered SQL statements without connecting or applying them. Arbitrary
developer validators remain runtime rules; the current SQL vocabulary supplies
17 scalar types without length/precision parameters.

The optional fifth argument supplies existing `FieldRefInfo` values for columns
that will receive data. Generation stages `SET NOT NULL` after the backfill and
preserves simultaneous rename/type/default changes. Initial and incremental SQL
share column rendering; unsupported attributes require explicit SQL.

The migration catalog is under `migrations/catalog.json`. Each migration has a
numbered SQL script and `metadata.json`; new migration IDs and directories also
carry the sequence prefix. Metadata preserves schema snapshots, decisions, checks
and frozen validators. Passwords remain in database settings.

## Migration decisions

Collect choices for an existing migration draft:

```sh
npm run migration:decide -- --draft migration-draft.json --answers answers.json
```

The answers file contains `{id, revisionHash, decisions}` using the draft's ID and
current revision. Decisions use the existing `discard`, `migrate`, or `check`
definitions. Transformation references must exist in the draft. Valid partial
answers are saved while other changes remain pending; invalid or stale answers
leave the draft untouched. No project adapter or conflict report is required.
Inference, generation and apply reuse the same decision validation.

## Migration assembly

`createMigrationDraft` creates an editable draft from the loaded backend SSOT and
source schema. `assembleMigration` orders schema SQL, transformations and checks
using existing resource callbacks. Structure-only assembly needs a resource sink.
`saveMigrationArtifact` writes an immutable directory, sharing manifest construction
with verification. The saved compilation is `authoring.json`; the duplicate
`compiled.json` has been removed. Assembly and saving are separate from verification
and database application.

```sh
npm run test:assembly
```

This test creates a migration from the backend SSOT, saves it, loads its files and
executes the saved SQL on an owned scratch database to verify the resulting schema.

## Migration history

The migration library uses an ordered core catalog and the database's recorded
baseline/current pointer. Applied migrations must be an unchanged prefix; later
entries are pending. `bootstrapHistory` creates only the pointer and applied-history
tables. `appendCommittedMigration` updates both in the same transaction as the SQL.
`readMigrationHistory` also rejects drift from the schema saved for the applied head.

`readMigrationCatalog(baseline, orderedDirectories)` reads saved migration manifests
using the explicit order and core catalog types. `readMigrationStatus` combines
that catalog with the pointer and applied log in one journal query. It reports
applied/pending entries without schema inspection or database writes. The existing
drift-checking API reuses this reader.

`verifyMigrationFiles(directory, expected)` checks the saved manifest against its
expected catalog identity and verifies authoring, SQL/check/query and validator
file hashes. It reads files without executing SQL or importing validator code.
New manifests also bind the resource registry through the existing `FileInfo`
contract; older manifests remain readable.

The [24-point assessment](docs/migration-assessment.md) records capability status,
source responsibilities, remaining duplication and legacy workflows beyond that scope.

SSOT authoring also supports `infer`, `generate` and standalone `data` commands
with `--ssot` and `--database`. New migrations bind saved source/target schemas
to their immutable authoring files. Role settings now use `{user, password, ...}`
driver connections for `initialUser`, `owner` and `appUser`; the backend uses the
app connection. Role provisioning and permission checks are separate SDK APIs.
The apply command generates migrations from the SSOT when needed, then verifies
immutable files, history integrity and drift before using locked owner transactions.
Ambiguous changes save a draft and block until its data decisions are resolved.
Schema, declared data requirements and permissions are checked before success and
pointer advancement. Failed operations roll back and retain an execution attempt.
Deployment activation, readiness and separate corrective workflows were removed.

```sh
npm run migration:apply
npm run migration:status
```

These scripts support a fresh database directly. The initial migration saves
owner/app role setup for the supplied initial administrator, followed by schema,
data and permissions under the owner connection. An existing catalog is retained.

```sh
npm run migration:apply
```

```sh
npm run test:history
```

The test uses an owned scratch database to verify pending status, commit/rollback,
checksums and drift. Scratch databases use the initial administrator; production
migrations use the owner. The current initial migration was compacted into
[`0001_initial.sql`](migrations/entries/initial/0001_initial.sql) and metadata without
changing its recorded hash. Its originally external role setup is marked as a
historical declaration. Newly generated initial migrations record that phase too.

## Run the backend

```sh
docker compose up --build -d --wait
```

Compose runs PostgreSQL 18.6 and the backend. The backend connects as the app user
using `PGUSER`/`PGPASSWORD` or `DATABASE_URL`. Compose starts the database and app;
run the SDK apply command above to provision a fresh database before using the app.
Migration execution remains an explicit command.

For a host process, configure `.env`, start PostgreSQL, build, and run `npm start`.
PostgreSQL is exposed on `127.0.0.1:5433`; the Docker backend is on port 3000.

## Frontend and API contract

Open `http://localhost:3000/` after starting the backend (`/menu` redirects there).
The small TypeScript page discovers entities from the API and provides a table,
create/edit form and delete confirmation for each one. Entity and field names
are not hardcoded. Text, integer and boolean editors preserve null separately
from empty text, zero and false. New types require an editor at compile time.

`npm run build` compiles the backend and browser separately, using a TypeScript
project reference for the backend declarations. The frontend imports the API
contract with `import type`; no SSOT implementation, database settings, validators
or migration code is emitted into the browser. There is no frontend framework
or additional dependency.

Every route except `/health` (the page, its assets and the API) requires HTTP Basic
authentication against `ssot.usuarios`. The `usuarios` entity is part of the SSOT
schema but is not exposed by the API. Create a local test user after applying
migrations:

```sh
docker exec ssot2026-postgres-1 psql -U ssot2026_owner -d ssot2026 -c "INSERT INTO ssot.usuarios (usuario, clave) VALUES ('admin', 'admin123');"
```

`GET /health` checks the database connection. `GET /api/entities` returns the
available entity names. `GET /api/entities/:name` returns `{name, pk, columns, rows}`,
with only `{name, label, type, nullable}` for each column. Keys identify rows for
editing/deletion; nullability controls the form's explicit "Sin valor" option.

All mutations use JSON at `/api/entities/:name`:

- `POST`: the complete new row.
- `PUT`: `{key, row}`, with the original primary key and the complete replacement row.
- `DELETE`: the primary-key object.

Successful mutations return HTTP 204. The backend checks exact field sets, types,
nullability and declared entity validators using system-definition before writing
through the app connection. SQL values are parameterized. Unknown entities or
missing rows return 404, invalid input returns 400, and database constraint
conflicts return 409. Unexpected failures return 500 without exposing SQL details.
The old `/poc/*` handlers were replaced by this shared API.

The types in `src/backend/api-contract.ts` derive field names, value types,
nullability, and primary keys from the backend definitions. Browser code can
import this contract with `import type`.

```sh
npm run test:api
npm run test:crud
```

`test:api` includes API contract type checks and HTTP behavior tests. `test:crud`
requires the configured database and exercises the app role inside a transaction
that is always rolled back. This initial page loads all rows; pagination and
specialized field widgets are separate future steps.

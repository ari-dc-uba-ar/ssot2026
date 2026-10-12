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
with the app role. The loader requires distinct owner/app names; applying database
permissions is a later step. CLI output includes connection identity and role names.
`initialUser` takes the driver's `ClientConfig` with a required username. The app
supplies it through `POSTGRES_USER`/`POSTGRES_PASSWORD`; its credentials are omitted
from CLI output. It is reserved for initial role and permission setup.
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

The published initial release remains under `migrations/releases/initial`.
The SSOT test confirms that the current domain model matches its saved snapshot.

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
SSOT draft creation and assembly are available as library functions; complete CLI
composition remains a separate step.

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

```sh
npm run test:history
```

The test uses an owned scratch database to verify pending status, commit/rollback,
checksums and drift. The existing local journal and immutable releases are retained.

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

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
migrations use the owner. Each migration is stored as numbered SQL plus metadata
that binds its steps, resources, saved states and recorded hashes. Initial role
setup runs through the initial administrator; schema changes and table grants run
through the owner.

Automatic `SELECT, INSERT, UPDATE, DELETE` grants apply only to tables created by
that migration. Changes to existing tables preserve their permissions. A migration
that creates no tables has no generated permissions step. Provisioning revokes the
former default-privileges rule, so unrelated future tables receive no automatic
app access. Generated scripts omit boilerplate comments and preserve authored SQL
comments; metadata retains checks, validators and auxiliary resources.

The migration artifacts were regenerated together under this policy, preserving
their saved SSOT/schema states and updating SQL, resources, manifests and catalog
hashes. Existing installations that recorded the previous migration hashes will
reject this rewritten history; retain the previous artifacts for those
installations or plan a separate baseline transition. Regeneration does not
rewrite a database's migration journal.

`npm run test:migrations` verifies the saved artifact hashes and the per-table grant
policy without connecting to PostgreSQL.

## Run the backend

Only Docker with Compose is required on the host. Node, npm and the migration
CLI run inside the image and containers.

Copy `.env.example` to `.env` and set `JWT_SECRET` to a random secret of at least
32 bytes. Configure `AUTH_ADMIN_USERNAME` and `AUTH_ADMIN_PASSWORD` for the first
startup with an empty users table (see Authentication and users below).

```sh
docker compose build
docker compose run --rm migrations
docker compose up -d --wait
```

The build and foreground migration command print their output, including errors,
directly in the terminal and return a nonzero exit code on failure. Continue to the
next command after the previous one succeeds. The last command starts the app in
the background and waits for the backend to become healthy.

The image build compiles the app and loads the SSOT, SQL mapping and database
settings with `migration:load`. Database work runs at startup: Compose waits for
PostgreSQL 18.6 to become healthy, runs `migration:apply` in the `migrations`
service, then starts the backend only after that service exits successfully.
Apply provisions roles, generates migrations when needed, verifies history and
drift, and applies pending schema/data/permission changes. Existing migrations
are retained and already applied entries are verified on subsequent starts.

The migration service receives the initial administrator and owner credentials
from `.env` or the local defaults in `compose.yaml`. The backend connects as the
app user using `PGUSER`/`PGPASSWORD`. Migration files and unresolved drafts persist
in the checkout's `migrations/` directory. Changes needing data decisions stop
startup and report the problem; resolve the saved draft before retrying.

`docker compose up --build -d --wait` also applies migrations automatically.
Detached Compose reports a failed dependency; inspect the detailed migration
output with `docker compose logs migrations`. For a single command with live
output, use `docker compose up --build`.

To inspect migration status or review automatic startup output:

```sh
docker compose run --rm migrations npm run migration:status
docker compose logs migrations
```

Other migration scripts can also run inside the service with
`docker compose run --rm migrations npm run <script>`. To resolve a saved draft,
put its answers in `migrations/answers.json` and run:

```sh
docker compose run --rm migrations npm run migration:decide -- --draft migrations/draft.json --answers migrations/answers.json
```

For a host process, configure `.env` (including `JWT_SECRET`), start PostgreSQL, build, and run `npm start`.
PostgreSQL is exposed on `127.0.0.1:5433`; the Docker backend is on port 3000.

## Authentication and users

Set `JWT_SECRET` to a random secret of at least 32 bytes before starting the backend
or Compose. Generate one with
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
The backend rejects missing/short secrets. Apply the included incremental migration
with `npm run migration:apply`; the migration catalog creates `usuarios` and the
incremental `0003_authenticated_administrators` removes the obsolete role/status
columns while preserving accounts, credentials and the previous migration files.

On cold start, the backend initializes the first account before listening for
requests. If `usuarios` is empty, `AUTH_ADMIN_USERNAME` and `AUTH_ADMIN_PASSWORD`
(12–128 characters) must be configured; otherwise startup fails without creating
an account. The bootstrap prints eight recovery codes once. Save them. If any
account already exists, initialization does nothing, requires no bootstrap
credentials, and preserves every account, password, code and session version.
An advisory transaction lock makes concurrent initializations idempotent. Compose
passes the two variables to the backend automatically. The same initialization
can also be run manually with `npm run auth:create-admin` or:

```sh
docker compose run --rm -e AUTH_ADMIN_USERNAME -e AUTH_ADMIN_PASSWORD backend npm run auth:create-admin
```

Log in on the home page. Every authenticated account is an administrator and can
create, edit and delete users through the same CRUD used for other entities. There
are no role or activation-state columns and no account-specific deletion rules.
Usernames are case-insensitive and accept 3–64 ASCII
letters, digits, underscores, dots or hyphens. IDs are generated on the server.
The password is required on creation and optional on editing; omission preserves
the existing hash. Updating or deleting the current account has the same effect
as updating or deleting another account, including revocation of its JWTs.

Passwords use salted scrypt (`N=32768, r=8, p=3`). JWTs use HS256 through `jose`,
expire after 15 minutes and validate the algorithm, issuer, audience and required
claims. Every authenticated request also checks the account's existence and
session version. Account updates, password resets/changes and logout
revoke existing sessions. Logout closes all sessions for that account. The browser
keeps its token in memory; reloading requires logging in again.

The users table is a required SSOT entity. Anonymous access is limited to login
and recovery handlers; all entity CRUD requires authentication.
The app's PostgreSQL role reads credential hashes internally for authentication.
Column security is enforced by the API: `readable: false` excludes a column from
SQL SELECTs, response rows, column metadata and public TypeScript row types;
`writable: false` rejects direct assignment. The ID is read-only, and password
hashes, recovery hashes and session versions are private and server-managed.
Generic field behaviours declare input aliases, input types, hashing and generated
values in the SSOT. The password input is a `password` type whose behaviour and
length constraints are defined in `src/backend/value-types.ts`; its stored value is
a text hash. Input validation checks that type before applying the write transform.
Type behaviours validate individual values, while entity validators handle rules
across fields. The frontend selects an editor by input type and receives its
constraints from the API. Neither CRUD nor the editor branches on the entity name.
Other entity fields keep their existing read/write behavior after authentication.

`año` uses `posInteger` (an integer greater than zero). `regularidad` accepts only
`Libre` or `Regular`, and `cuatrimestre` only `1C` or `2C`. Their type definitions
in `src/backend/value-types.ts` supply validation behaviours and editor constraints;
the enum types also produce TypeScript literal unions. Nullability remains a
separate field property, so `regularidad` still permits `null`.
The API enforces these rules on writes and keys. PostgreSQL mappings store
`posInteger` as integer and enums as text; type behaviours do not generate SQL
`CHECK` constraints.

From **Contraseña y códigos de recuperación**, each user can generate and download
eight random 128-bit recovery codes after confirming their password. Newly created
users should do this after their first login. Only SHA-256 hashes are stored. The
codes are displayed once and are replaced on regeneration. On the public recovery
form, a username, one code and a new password reset the account in one atomic SQL
update. Concurrent reuse succeeds once. Recovery replaces the entire previous set,
returns eight new codes to save, and requires logging in again. Changing a password
also replaces the code set. An administrator reset clears the old codes; the user
can generate new ones after logging in. Login, recovery and password verification
share a limit of 20 requests per IP per 15 minutes in each backend process.

| Endpoint | Authentication | JSON body / result |
| --- | --- | --- |
| `POST /api/auth/login` | Public | `{usuario, contrasena}` → `{token, expiresIn, user}` |
| `POST /api/auth/recover` | Public | `{usuario, codigo, contrasena}` → `{codes}` |
| `GET /api/auth/me` | Bearer JWT | `{id, usuario}` |
| `POST /api/auth/password` | Bearer JWT | `{contrasenaActual, contrasena}` → `{codes}` |
| `POST /api/auth/recovery-codes` | Bearer JWT | `{contrasena}` → `{codes}` |
| `POST /api/auth/logout` | Bearer JWT | HTTP 204 |

## Frontend and API contract

Open `http://localhost:3000/` after starting the backend (`/menu` redirects there).
The small TypeScript page discovers entities from the API and provides a table,
create/edit form and delete confirmation for each one. Entity and field names
are not hardcoded. Foreign keys use dropdowns populated from the referenced entity.
Option labels combine the field's code and readable fields marked `isName` in
the SSOT; plans display their number and description. Nullable references include
`Ninguna`, which stores `null`. Required references require an explicit selection.
FK relationships separate inherited keys into related dropdowns. Columns that
always occur together in those relationships form one selection, such as the
month/year portion of a Course key. An Enrolment can therefore select Department,
Subject, Period and Student while submitting all underlying columns separately.
Each dropdown has one option per distinct code and `isName` combination.
The same code/name under several parent keys appears
once; different names for the same code remain distinct options. Parent key
prefixes are omitted from individual labels. Related selections filter options
in both directions, including through shared columns on overlapping FKs.
Changing a selection preserves compatible values and clears incompatible ones.
Clearing a selection removes its filter; required fields still need a value
before saving. The frontend also reads parent FKs from referenced entities,
without requiring redundant relationships on the edited entity. Narrower FK
relationships identify the key described by an entity's `isName`. Independent relationships,
including those on a join table, keep independent selections within their shared
context.
Positive integer inputs use the type's minimum; enum inputs show its allowed values
without selecting one automatically. Text, password, integer, enum and boolean editors preserve null separately
from empty text, zero and false. New types require an editor at compile time.

`npm run build` compiles the backend and browser separately, using a TypeScript
project reference for the backend declarations. The frontend imports the API
contract with `import type`; no SSOT implementation, database settings, validators
or migration code is emitted into the browser. There is no frontend framework
or additional dependency.

`GET /health` checks the database connection. All `/api/entities` requests require
`Authorization: Bearer <JWT>`. `GET /api/entities` returns the
available entity names. `GET /api/entities/:name` returns `{name, pk, columns, inputs, foreignKeys, rows}`,
with only `{name, label, type, nullable, writable}` for each readable column. Keys identify rows for
editing/deletion; nullability controls the form's explicit "Ninguna" option.
`inputs` describes writable input names, labels, types, nullability, type constraints
and whether omission on update preserves the stored value. A write-only password
input is available to the editor without exposing the stored hash as a column.
`foreignKeys` supplies each editable relationship's name, target entity, mapping
from input names to referenced columns, and readable display fields. The editor
loads the referenced entities and their parent relationships through the
authenticated API when opening a form.
The `materias.plan` relationship references `planes.plan`; deleting or renumbering
a referenced plan is rejected. Migration `0004_materias_plan_fk` adds only that
constraint and requires existing non-null plan values to have matching rows.

All mutations use JSON at `/api/entities/:name`:

- `POST`: the complete new row using the names declared in `inputs`.
- `PUT`: `{key, row}`, with the original primary key and writable inputs, omitting optional inputs to preserve their stored values.
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

`test:api` includes API contract type checks and HTTP authentication, authorization
and column-security tests. `test:crud` requires the configured migrated database;
it exercises domain CRUD in a rolled-back transaction and authentication with the
app role in owned scratch databases, including concurrent cold starts, configured
bootstrap credentials, migration of existing accounts, concurrent recovery-code
reuse, generic user CRUD and session revocation. The page loads all rows and uses
client-side pagination. Users can select rows for bulk deletion; the API checks
SSOT-declared foreign-key dependencies and rejects the entire batch when any
selected row is referenced. The dependency dialog identifies the referencing
entity and relationship, and shows up to ten dependent row keys.

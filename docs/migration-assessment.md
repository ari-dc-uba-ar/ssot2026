# Migration assessment

Assessment date: 2026-10-12. Scope: the sibling system-definition PostgreSQL
migration consumer, core contracts and this application's integration.

All 24 capabilities are implemented within the supported PostgreSQL/SQL mapping
vocabulary. The approved cleanup removes 16 legacy modules and their exports,
adapters and tests: deployment activation/readiness, mandatory rehearsal policy,
and separately journaled corrective preparations. SSOT apply/status are wired.
Existing history and immutable initial releases are preserved.

## Checklist

| # | Responsibility | Implementation and reuse |
| --- | --- | --- |
| 1 | Load typed SSOT. | `ssot.ts` reuses core decoding through `sql-mapping.ts`. |
| 2 | Load database settings and connection identities. | Driver connection types in `database-settings.ts`; connecting remains separate. |
| 3 | Map SSOT into expected SQL schema. | Explicit mappings; `projectSsotSchema` reuses `projectSchema`. |
| 4 | Read actual schema. | `inspect-schema.ts` reads PostgreSQL catalogs, including unsupported objects. |
| 5 | Compare schemas. | Shared comparison and normalization used by assessment and execution. |
| 6 | Classify differences. | `classify-schema.ts` owns preserving/data-check/destructive/unsupported rules. |
| 7 | Collect migration-specific decisions and transformations. | Answers bind to draft ID/revision and reconstructed change IDs. |
| 8 | Validate decisions against differences. | One validator reused by inference, resolution and compilation. |
| 9 | Generate schema SQL. | Incremental and initial SQL share type/column/constraint renderers. |
| 10 | Assemble/save ordered migrations, transformations and checks. | Assembly, resource emission and atomic publication are separate. New IDs/directories have sequence prefixes; each migration contains numbered SQL plus metadata. |
| 11 | Read catalog and database history. | Core catalog contracts plus saved states and journal readers. |
| 12 | Verify migration file hashes. | Read-only verification of manifests, resources, validators and bound states. |
| 13 | Verify unchanged applied prefix and pointer. | `describeMigrationHistory` reuses journal continuity checks. |
| 14 | Check drift against saved head. | Compare with recorded schema before apply; user reconciles drift. |
| 15 | Provision initial owner/app roles and permissions. | New initial migrations save the role/schema setup SQL; `initialUser` executes that resource with passwords supplied at runtime. |
| 16 | Prevent concurrent execution. | Dedicated scope lock; operation-session lock prevents racing recovery. |
| 17 | Execute migrations transactionally. | Existing executor runs each migration in one owner transaction. |
| 18 | Verify resulting schema/constraints. | Inspection, normalization and comparison before recording success. |
| 19 | Verify migration-specific data requirements. | Declared SQL checks, transformation checkpoints and frozen validators. |
| 20 | Verify owner/app permissions. | Ownership, expected-table CRUD and app restrictions checked before/after. |
| 21 | Record success and advance pointer atomically. | History/pointer use the same transaction as SQL and verification. |
| 22 | Rollback and accurate failures. | Durable attempts; uncertain outcomes reconcile only after operation closes. |
| 23 | Wire apply command. | Typed handlers compose existing authoring, execution, journal and recovery. |
| 24 | Optional standalone data authoring. | `data` requires explicit SQL/effects and reuses catalog/executor. |

## Responsibility inventory

Paths are relative to system-definition/consumers/postgres-migrations/src.
Every production module appears below. Helpers inherit their owner's
responsibility; this inventory is traceability evidence, not a formal proof
that every line is minimal.

| Module | Points |
| --- | --- |
| `apply-migrations.ts` | 13–23 |
| `artifact-files.ts` | 10, 12 |
| `artifact.ts` | 10, 12, 14 |
| `assessment.ts` | 3, 4, 5, 6 |
| `authoring-cli.ts` | 7, 8, 24 |
| `authoring-contract.ts` | 7, 8, 10, 24 |
| `authoring-files.ts` | 10, 12 |
| `authoring-prompt.ts` | 24 |
| `authoring.ts` | 8, 10, 18, 19 |
| `build-validation.ts` | 10, 12, 19 |
| `canonical-hash.ts` | 7, 10, 12, 14 |
| `classify-schema.ts` | 6 |
| `cli-main.ts` | 23 |
| `cli.ts` | 23 |
| `compare-schema.ts` | 5 |
| `compile-data.ts` | 10, 17, 19, 24 |
| `compile-generated.ts` | 9, 10, 19 |
| `compiled-artifact.ts` | 10, 12, 18, 19 |
| `create-resources.ts` | 9, 10, 17, 18 |
| `data-validation.ts` | 19 |
| `data-authoring-codec.ts` | 7, 8, 10, 19 |
| `database-permissions.ts` | 9, 15, 20 |
| `database-settings.ts` | 2 |
| `dependency-order.ts` | 10 |
| `draft-revision.ts` | 7, 8, 10 |
| `execute-migration.ts` | 13, 14, 17–19, 21, 22 |
| `generate-create.ts` | 3, 9 |
| `generate-migration.ts` | 3, 9 |
| `generate-structure.ts` | 9 |
| `historical-validation.ts` | 19 |
| `history-schema.ts` | 11, 21 |
| `index.ts` | 1–24 |
| `infer.ts` | 5, 6, 7 |
| `inspect-schema.ts` | 4 |
| `journal-attempts.ts` | 22 |
| `journal-contracts.ts` | 11, 13, 16, 21, 22 |
| `journal-history.ts` | 11, 13, 21 |
| `journal-internal.ts` | 11, 13, 16, 21, 22 |
| `journal-lock.ts` | 16 |
| `journal-schema.ts` | 11, 21, 22 |
| `journal.ts` | 11, 13, 16, 21, 22 |
| `managed-data.ts` | 19 |
| `migration-artifact.ts` | 10, 12 |
| `migration-authoring.ts` | 7, 8, 19, 24 |
| `migration-catalog.ts` | 11 |
| `migration-decisions.ts` | 7, 8 |
| `migration-draft.ts` | 3, 5, 6, 7, 10 |
| `migration-history.ts` | 11, 13, 14 |
| `migration-integrity.ts` | 12 |
| `migration-plan-runtime.ts` | 12, 17, 19 |
| `migration-plan.ts` | 11, 12, 23 |
| `migration-store.ts` | 10–14 |
| `normalize-schema.ts` | 3–5, 14, 18 |
| `pg-ast.ts` | 9, 10, 19, 24 |
| `pg-identity.ts` | 3–5, 9, 14, 18 |
| `pg-schema.ts` | 2–4, 9, 17 |
| `pg-session.ts` | 2, 4, 16–19 |
| `pg-sql.ts` | 3, 4, 9, 17 |
| `pg-text.ts` | 2–4, 9 |
| `postgres-authoring.ts` | 10, 14, 17–19 |
| `postgres-support.ts` | 2, 4, 17 |
| `recovery.ts` | 22 |
| `runner.ts` | 17, 21 |
| `source-selection.ts` | 7, 10, 19, 24 |
| `sql-mapping.ts` | 1, 3 |
| `sql-resource.ts` | 10, 17, 19 |
| `ssot-authoring.ts` | 7–10, 24 |
| `ssot-cli.ts` | 23 |
| `ssot.ts` | 1 |
| `validation-artifact.ts` | 10, 12, 19 |
| `verify.ts` | 3–5, 9, 17–19 |

Core snapshots, persistence, file references, catalog/plan contracts, decoding
and ValidationResult/Problem are reused. App code supplies SSOT/mappings/settings
and uses app credentials for runtime queries. Tests and build scripts support
these owners. Older design/evidence documents describe historical workflows.

## Simplicity and remaining limits

StructureChangeInfo correlates actions with required before/after identities;
RenameInfo correlates field/entity endpoints and source/target sides. Supported
database objects now correlate kind with identity and parent. Required command
inputs are parsed at the CLI boundary and typed for authoring/apply. Compiled
checkpoint rows and validator metadata share their producer/executor types;
immutable artifacts are decoded fully before execution. Duplicate shape checks
and artifact error adapters were removed. Artifact results reuse core
ValidationResult/Problem. Manual/create dependency ordering, hashing, comparison,
decision validation and execution are reused.
Normal failure propagation needs no generic orchestration framework.
JSON, database rows and imported modules still require boundary validation.
Drafts now decode their complete nested shape before revision checking. Data
authoring and immutable checkpoints share field/domain/port decoders; semantic
compatibility checks consume those typed values. Catalog arrays reuse the core
decoder. The unreachable manual-row compilation loop was removed.

Manual/create/data ordering now shares one dependency sorter with the existing
lexical-queue and complete-layer policies preserved. Ancestor lookup is shared
by overlapping-writer checks. Unused artifact wrappers, latest-attempt lookup,
runtime grant execution, aliases, helpers and imports were removed. SQL literal
quoting and UTF-8 hashing reuse existing primitives. TypeScript now rejects unused
locals and parameters; exported type assertions remain compiled checks.

The remaining runtime-module cast validates callable exports at the import boundary;
TypeScript cannot verify an imported JavaScript function's signature at runtime.
Scratch/storage APIs remain in use by baseline and verification workflows.
Manual row-check authoring is limited. These do not constitute missing checklist
capabilities. SQL mappings support 17 scalar types without
length/precision parameters; arbitrary application validators are not inferred
into SQL constraints.

The journal has three tables for fresh installs. Existing column names such as
deployment_id remain for compatibility and store migration identity, with no
deployment lifecycle. Old extension tables are left intact. Initial provisioning
is separate from migration transactions; retries verify existing ownership.
Database drift is never repaired automatically.

Published resources now share one numbered SQL script and `metadata.json`, which
holds the existing contracts, source/target states and historical validator bytes.
The reader reconstructs their exact bytes and reuses the original hash checks.
New manifests also bind the whole readable SQL script. Table grants are saved
operations; apply verifies their result instead of silently adding extra grants.
The initial administrator and owner phases remain separate transactions.

The already-applied app migration was compacted without changing its identity,
pointer or history. Its formerly external role setup is explicitly labelled a
historical declaration; new initial migrations save that resource authoritatively.

## Verification

- SDK checks: 146 core tests, 237 consumer tests and 22 regression tests passed in the complete `test:all` run after pruning.
- PostgreSQL 18.6 generated/manual/mixed/data integrations and historical validators passed.
- SSOT CLI integration verified fresh roles/schema/journal, app CRUD/DDL separation, idempotence, upgrades, required-column decisions, file/drift/permission gates, concurrent rejection and rollback without pointer advancement.
- App checks: all 17 passed, including SSOT loading, migration assembly/assessment/history, API contracts and CRUD. Scratch database creation uses the initial administrator, while migration execution uses the restricted owner.
- No migration was applied to the live application database. Migration tests used owned scratch databases and test roles; app CRUD test writes were rolled back.
- The pruning pass removed a net 287 production lines, including the new shared decoder. Review covered unused compiler symbols, exported helpers and their consumers, duplicate implementation blocks, and the authoring/execution boundaries. No further concrete deletion was identified that preserves the supported workflows; this is a review result, not a claim that future simplification is impossible.

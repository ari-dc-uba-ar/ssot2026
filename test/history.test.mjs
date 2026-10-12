import assert from 'node:assert/strict';
import test from 'node:test';
import {completeMigrationCatalog} from 'system-definition';
import {appendCommittedMigration, bootstrapHistory, computeMigrationHash, createPostgresScratch, decodeSqlSsot, generateMigrationSql,
    inferStructureChanges, installBaseline, projectSsotSchema, readMigrationHistory, sha256Hex} from '@system-definition/postgres-migrations';
import {ssot, sqlMapping, myRecords} from '../dist/backend/system.js';
import {databaseSettings} from '../dist/backend/database.js';

const value = result => {if (!result.ok) throw new Error(JSON.stringify(result.problems)); return result.value;};

test('history keeps pending migrations and updates SQL, history and pointer in one transaction', async () => {
    const {schema} = databaseSettings.database;
    const scratch = createPostgresScratch({...databaseSettings.database, ...databaseSettings.owner}, [schema]);
    const handle = value(await scratch.create('clean-target'));
    const journal = {schema: schema + '_history'}, scope = {systemId: 'history-test', schemas: [schema]};
    const ref = (id, digit) => ({systemId: scope.systemId, releaseId: id, releaseHash: digit.repeat(64)});
    const A = ref('empty', '1'), B = ref('initial', '2'), C = ref('next', '3');
    const empty = {formatVersion: 1, engineVersion: '18.6', schemas: [schema], objects: []};
    const system = value(decodeSqlSsot(ssot, sqlMapping)), desired = value(projectSsotSchema(system, schema));
    const base = {from: A, to: B, fromSnapshotHash: '4'.repeat(64), toSnapshotHash: '5'.repeat(64), fromPersistenceHash: '6'.repeat(64), toPersistenceHash: '7'.repeat(64)};
    const sql = value(generateMigrationSql(value(inferStructureChanges(base, empty, desired, [])), empty, system, schema)).map(statement => statement.text).join('\n');
    const published = (id, from, to, text) => {
        const migration = {id, from, to, description: id, before: [], after: [], steps: [{id: 'sql', run: {kind: 'sql', name: id + '.sql', contentHash: sha256Hex(new TextEncoder().encode(text))}}]};
        return {migration, migrationHash: computeMigrationHash({formatVersion: 1, migration})};
    };
    const AB = published('initial', A, B, sql), BC = published('next', B, C, 'ALTER TABLE ssot.materias ADD COLUMN notes text;');
    const catalog = value(completeMigrationCatalog([A, B, C], [AB, BC]));
    const next = structuredClone(ssot);
    next.entities.materias.fields.notes = myRecords.completeField({type: 'text'}, 'notes');
    next.records.materia.notes = next.entities.materias.fields.notes;
    const schemas = {[A.releaseHash]: empty, [B.releaseHash]: desired, [C.releaseHash]: value(projectSsotSchema(value(decodeSqlSsot(next, sqlMapping)), schema))};
    const state = () => readMigrationHistory(handle.session, journal, scope, catalog, schemas).then(value);
    const entry = {installationId: handle.id, ordinal: 1, migrationId: AB.migration.id, migrationHash: AB.migrationHash, from: A, to: B, committedAt: '2026-10-11T00:00:00.000Z'};
    try {
        value(await bootstrapHistory(handle.session, journal));
        const tables = await handle.session.query('SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = $1 ORDER BY tablename', [journal.schema]);
        assert.deepEqual(tables.rows.map(row => row.tablename), ['installation', 'migration_history']);
        value(await installBaseline(handle.session, journal, {installationId: handle.id, scope, baseline: A}));
        assert.ok((await state()).migrations.every(migration => !migration.applied));
        await handle.session.query('BEGIN', []);
        await handle.session.query(sql, []);
        value(await appendCommittedMigration(handle.session, journal, A, entry));
        await handle.session.query('ROLLBACK', []);
        assert.equal((await state()).installation.current.releaseId, A.releaseId);
        assert.ok((await state()).migrations.every(migration => !migration.applied));
        await handle.session.query('BEGIN', []);
        await handle.session.query(sql, []);
        value(await appendCommittedMigration(handle.session, journal, A, entry));
        await handle.session.query('COMMIT', []);
        assert.deepEqual((await state()).migrations.map(migration => migration.applied), [true, false]);
        assert.equal((await readMigrationHistory(handle.session, journal, scope, {...catalog, migrations: [{...AB, migrationHash: '8'.repeat(64)}, BC]}, schemas)).ok, false);
        await handle.session.query('ALTER TABLE ssot.materias ADD COLUMN unexpected text', []);
        const drift = await readMigrationHistory(handle.session, journal, scope, catalog, schemas);
        assert.equal(drift.ok, false);
        assert.equal(drift.problems[0].messageKey, 'migration.schemaDrift');
    } finally {value(await scratch.destroy(handle));}
});

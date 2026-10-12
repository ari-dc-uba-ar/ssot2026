import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AuthoringFiles, appendCommittedMigration, assembleMigration, assessSchema, bootstrapHistory, createMigrationDraft, createPostgresScratch, decodeSqlSsot,
    installBaseline, openArtifactDirectory, projectSsotSchema, readMigrationCatalog, readMigrationStatus, saveMigrationArtifact, sha256Hex, verifyMigrationFiles} from '@system-definition/postgres-migrations';
import {ssot, sqlMapping} from '../dist/backend/system.js';
import {databaseSettings} from '../dist/backend/database.js';

const value = result => {if (!result.ok) throw new Error(JSON.stringify(result.problems)); return result.value;};

test('a saved migration from the backend SSOT contains the ordered SQL needed to create its schema', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ssot-assembly-'));
    const {schema} = databaseSettings.database;
    const scratch = createPostgresScratch({...databaseSettings.database, ...databaseSettings.initialUser}, [schema]);
    let handle;
    try {
        handle = value(await scratch.create('clean-target'));
        const target = value(decodeSqlSsot(ssot, sqlMapping));
        const current = {formatVersion: 1, engineVersion: '18.6', schemas: [schema], objects: []};
        const base = {from: {systemId: ssot.systemId, releaseId: 'empty', releaseHash: '1'.repeat(64)}, to: {systemId: ssot.systemId, releaseId: 'initial', releaseHash: '2'.repeat(64)},
            fromSnapshotHash: '3'.repeat(64), toSnapshotHash: '4'.repeat(64), fromPersistenceHash: '5'.repeat(64), toPersistenceHash: '6'.repeat(64)};
        const draft = value(createMigrationDraft('initial', base, current, target, schema));
        const files = new AuthoringFiles();
        const assembled = value(await assembleMigration(draft, current, value(projectSsotSchema(target, schema)), {
            emitResource: files.emitResource.bind(files),
        }));
        const destination = join(directory, 'initial');
        const published = value(await saveMigrationArtifact(destination, assembled, files));
        const catalog = value(await readMigrationCatalog(base.from, [destination]));
        const journal = {schema: schema + '_history'}, scope = {systemId: ssot.systemId, schemas: [schema]};
        value(await bootstrapHistory(handle.session, journal));
        value(await installBaseline(handle.session, journal, {installationId: handle.id, scope, baseline: base.from}));
        const status = () => readMigrationStatus(handle.session, journal, scope, catalog).then(value);
        assert.deepEqual((await status()).migrations.map(migration => migration.applied), [false]);
        const reader = value(await openArtifactDirectory(destination));
        const verified = value(await verifyMigrationFiles(destination, published));
        await handle.session.query('BEGIN', []);
        for (const step of verified.authoring.migration.steps) {
            const bytes = value(await reader.read('generated/' + step.run.contentHash + '.sql'));
            assert.equal(sha256Hex(bytes), step.run.contentHash);
            await handle.session.query(new TextDecoder().decode(bytes), []);
        }
        value(await appendCommittedMigration(handle.session, journal, base.from, {installationId: handle.id, ordinal: 1,
            migrationId: published.migration.id, migrationHash: published.migrationHash, from: base.from, to: base.to, committedAt: new Date().toISOString()}));
        await handle.session.query('COMMIT', []);
        assert.deepEqual((await status()).migrations.map(migration => migration.applied), [true]);
        assert.deepEqual(value(await assessSchema(target, schema, handle.session)), {equal: true, differences: []});
    } finally {
        if (handle) value(await scratch.destroy(handle));
        await rm(directory, {recursive: true, force: true});
    }
});

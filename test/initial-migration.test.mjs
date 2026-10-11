import assert from 'node:assert/strict';
import test from 'node:test';
import {
    connectPostgres, createPostgresScratch, loadReleaseArtifact,
    prepareSqlResource, executePreparedSqlResource, runCheckResource,
} from '@system-definition/postgres-migrations';
import {completeEntity} from 'system-definition';
import {databaseConfig, getMigrationDatabaseConfig} from '../dist/backend/database.js';
import {valueOf} from '../dist/backend/initial-migration.js';
import {selectQuery, insertQuery, updateQuery, deleteQuery} from '../dist/backend/queries.js';
import {captureSnapshot, myRecords, myEntities} from '../dist/backend/system.js';

test('published initial SQL gives the app CRUD access and keeps DDL with the owner', async () => {
    const artifact = valueOf(await loadReleaseArtifact('migrations/releases/initial'));
    assert.deepEqual(artifact.snapshot, valueOf(captureSnapshot()));
    const scratch = createPostgresScratch(getMigrationDatabaseConfig(), ['ssot']);
    const handle = valueOf(await scratch.create('clean-target'));
    let app;
    try {
        // Execute the published bytes, not regenerated SQL from the current source.
        const refs = [...artifact.createPlan.generatedSql, ...artifact.createPlan.extraResources.map(resource => resource.run)];
        for (const ref of refs) {
            const resource = artifact.resources[ref.name];
            valueOf(await executePreparedSqlResource(handle.session, valueOf(prepareSqlResource({ref, text: resource.text}))));
        }
        for (const ref of artifact.manifest.invariantChecks) {
            valueOf(await runCheckResource(handle.session, {ref, text: artifact.resources[ref.name].text}));
        }
        const config = {...databaseConfig, database: handle.id};
        if (config.connectionString) {
            const url = new URL(config.connectionString);
            url.pathname = '/' + handle.id;
            config.connectionString = url.toString();
        }
        app = await connectPostgres(config);
        const materias = completeEntity(myRecords, myEntities.materias);
        const insert = insertQuery(materias, {cod_mat: 'TEST', materia: 'Smoke test', obligatoria: true});
        const select = selectQuery(materias);
        const update = updateQuery(materias, {materia: 'Smoke test', obligatoria: false});
        const del = deleteQuery(materias, {materia: 'Smoke test'});
        await app.query('BEGIN', []);
        await app.query(insert.text, insert.values);
        assert.equal((await app.query(select.text, select.values)).rows[0].obligatoria, true);
        assert.equal((await app.query(update.text, update.values)).rowCount, 1);
        assert.equal((await app.query(del.text, del.values)).rowCount, 1);
        await app.query('ROLLBACK', []);
        await assert.rejects(app.query('CREATE TABLE ssot.app_ddl_test (id integer)', []), /permission denied/);
        await assert.rejects(app.query('ALTER TABLE ssot.materias ADD COLUMN app_ddl_test integer', []), /must be owner/);
        const owner = (await handle.session.query('SELECT current_user AS username', [])).rows[0].username;
        await assert.rejects(app.query('SET ROLE "' + owner.replaceAll('"', '""') + '"', []), /permission denied/);
        await handle.session.query('BEGIN', []);
        await handle.session.query('ALTER TABLE ssot.materias ADD COLUMN owner_ddl_test integer', []);
        await handle.session.query('ROLLBACK', []);
    } finally {
        await app?.close();
        valueOf(await scratch.destroy(handle));
    }
});

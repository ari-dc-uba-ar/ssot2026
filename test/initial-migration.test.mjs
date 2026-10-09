import assert from 'node:assert/strict';
import test from 'node:test';
import {
    connectPostgres, createPostgresScratch, loadReleaseArtifact,
    prepareSqlResource, executePreparedSqlResource, runCheckResource,
} from '@system-definition/postgres-migrations';
import {databaseConfig, getMigrationDatabaseConfig} from '../dist/backend/database.js';
import {valueOf} from '../dist/backend/initial-migration.js';
import {captureSnapshot} from '../dist/backend/system.js';

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
        await app.query('BEGIN', []);
        await app.query('INSERT INTO ssot.materias (cod_mat, materia, obligatoria) VALUES ($1, $2, $3)', ['TEST', 'Smoke test', true]);
        assert.equal((await app.query('SELECT obligatoria FROM ssot.materias WHERE materia = $1', ['Smoke test'])).rows[0].obligatoria, true);
        assert.equal((await app.query('UPDATE ssot.materias SET obligatoria = false WHERE materia = $1', ['Smoke test'])).rowCount, 1);
        assert.equal((await app.query('DELETE FROM ssot.materias WHERE materia = $1', ['Smoke test'])).rowCount, 1);
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

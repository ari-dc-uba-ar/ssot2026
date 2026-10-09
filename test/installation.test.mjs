import assert from 'node:assert/strict';
import {appendFile, cp, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createPostgresScratch, connectPostgres, quotePgIdentifier} from '@system-definition/postgres-migrations';
import {databaseConfig, getMigrationDatabaseConfig} from '../dist/backend/database.js';
import {valueOf} from '../dist/backend/initial-migration.js';
import {ensureInitialInstallation} from '../dist/backend/release-installation.js';

function forDatabase(config, database) {
    const result = {...config, database};
    if (result.connectionString) {
        const url = new URL(result.connectionString);
        url.pathname = '/' + database;
        result.connectionString = url.toString();
    }
    return result;
}
async function withDatabase(run) {
    const scratch = createPostgresScratch(getMigrationDatabaseConfig(), ['ssot']);
    const handle = valueOf(await scratch.create('clean-target'));
    try {
        await run(handle.session, forDatabase(getMigrationDatabaseConfig(), handle.id), handle.id);
    } finally {
        valueOf(await scratch.destroy(handle));
    }
}

test('installation records a baseline, is idempotent, and leaves the journal private', async () => {
    await withDatabase(async (session, config, database) => {
        const first = await ensureInitialInstallation(config);
        assert.equal(first.alreadyInstalled, false);
        assert.equal(first.installation.current.releaseId, 'initial');
        await session.query('INSERT INTO ssot.materias (materia) VALUES ($1)', ['Keep this row']);
        const second = await ensureInitialInstallation(config);
        assert.equal(second.alreadyInstalled, true);
        assert.equal(second.installation.installationId, first.installation.installationId);
        assert.equal((await session.query('SELECT count(*)::integer AS count FROM ssot.materias', [])).rows[0].count, 1);
        assert.equal((await ensureInitialInstallation(config, undefined, true)).alreadyInstalled, true);
        const app = await connectPostgres(forDatabase(databaseConfig, database));
        try {
            await assert.rejects(app.query('SELECT * FROM ssot_migrations.installation', []), /permission denied/);
        } finally { await app.close(); }
    });
});

test('schema drift blocks a subsequent installation check', async () => {
    await withDatabase(async (session, config) => {
        await ensureInitialInstallation(config);
        await session.query('ALTER TABLE ssot.materias ADD COLUMN unexpected integer', []);
        await assert.rejects(ensureInitialInstallation(config), /migration.schemaDrift/);
    });
});

test('untracked tables are rejected and installation metadata rolls back', async () => {
    await withDatabase(async (session, config) => {
        await session.query('CREATE TABLE ssot.legacy (id integer)', []);
        await assert.rejects(ensureInitialInstallation(config), /migration.baselineRequired/);
        assert.equal((await session.query("SELECT to_regnamespace('ssot_migrations')::text AS journal", [])).rows[0].journal, null);
        assert.equal((await session.query("SELECT to_regclass('ssot.materias')::text AS table", [])).rows[0].table, null);
    });
});

test('changed published SQL and a changed recorded release are rejected', async () => {
    await withDatabase(async (session, config) => {
        const directory = await mkdtemp(join(tmpdir(), 'ssot2026-artifact-'));
        try {
            await cp('migrations/releases/initial', directory, {recursive: true});
            await appendFile(join(directory, 'resources/create-tables.sql'), '-- modified\n');
            await assert.rejects(ensureInitialInstallation(config, directory), /migration.checksumMismatch/);
            assert.equal((await session.query("SELECT to_regnamespace('ssot_migrations')::text AS journal", [])).rows[0].journal, null);
        } finally { await rm(directory, {recursive: true, force: true}); }
        await ensureInitialInstallation(config);
        await session.query('UPDATE ssot_migrations.installation SET current_release_hash = $1', ['0'.repeat(64)]);
        await assert.rejects(ensureInitialInstallation(config), /migration.headMismatch/);
    });
});

test('lost app permissions block verification', async () => {
    await withDatabase(async (session, config) => {
        await ensureInitialInstallation(config);
        const app = await connectPostgres(databaseConfig);
        let username;
        try { username = (await app.query('SELECT current_user AS username', [])).rows[0].username; }
        finally { await app.close(); }
        await session.query(`REVOKE SELECT ON ssot.materias FROM ${quotePgIdentifier(username)}`, []);
        await assert.rejects(ensureInitialInstallation(config), /migration.checkFailed/);
    });
});

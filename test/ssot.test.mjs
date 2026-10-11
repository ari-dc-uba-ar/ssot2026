import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {loadSsot} from '@system-definition/postgres-migrations/ssot';
import {loadDatabaseSettings} from '@system-definition/postgres-migrations/database';
import {decodeSystemSnapshot} from 'system-definition';
import {ssot} from '../dist/backend/system.js';
import {databaseSettings, databaseConfig} from '../dist/backend/database.js';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';

test('the migration loader reads the backend SSOT using the core contract', async () => {
    assert.deepEqual(await loadSsot('dist/backend/system.js'), {ok: true, value: ssot});
    assert.deepEqual(Object.keys(ssot.entities), ['materias', 'pabellones']);
    const initial = decodeSystemSnapshot(JSON.parse(await readFile('migrations/releases/initial/snapshot.json', 'utf8')));
    assert.equal(initial.ok, true);
    assert.deepEqual(ssot, initial.value);
});

test('the app supplies one database configuration and separate owner/app identities', async () => {
    assert.deepEqual(await loadDatabaseSettings('dist/backend/database.js'), {ok: true, value: databaseSettings});
    assert.equal(databaseConfig.database, databaseSettings.database.database);
    assert.equal(databaseConfig.user, databaseSettings.appUser);
    assert.notEqual(databaseSettings.owner, databaseSettings.appUser);
});

test('the CLI loads both inputs without returning connection secrets', async () => {
    const require = createRequire(import.meta.url);
    const cli = join(dirname(require.resolve('@system-definition/postgres-migrations')), 'cli-main.js');
    const root = await mkdtemp(join(tmpdir(), 'ssot-database-input-'));
    try {
        const file = join(root, 'database.mjs');
        const settings = {...databaseSettings, database: {...databaseSettings.database, password: 'test-only-secret'}};
        await writeFile(file, `export const databaseSettings = ${JSON.stringify(settings)};`);
        const result = spawnSync(process.execPath, [cli, 'capture', '--ssot', 'dist/backend/system.js', '--database', file], {encoding: 'utf8'});
        assert.equal(result.status, 0, result.stderr);
        const loaded = JSON.parse(result.stdout);
        assert.equal(loaded.ok, true);
        assert.equal(loaded.value.ssot.systemId, ssot.systemId);
        assert.equal(loaded.value.database.owner, databaseSettings.owner);
        assert.equal(loaded.value.database.appUser, databaseSettings.appUser);
        assert.equal(loaded.value.database.database.database, databaseSettings.database.database);
        assert.ok(!result.stdout.includes('test-only-secret'));
    } finally { await rm(root, {recursive: true, force: true}); }
});

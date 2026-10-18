import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {captureMigrationState, decodeSqlSsot, jsonBytes, migrationDirectory, readCatalogState, readStateBytes, readStoredCatalog, sha256Hex, verifyMigrationFiles} from '@system-definition/postgres-migrations';
import {ssot, sqlMapping, migrationAuthoring} from '../dist/backend/system.js';

const value = result => { if (!result.ok) throw new Error(JSON.stringify(result.problems)); return result.value; };

test('authored migration checks load exact bytes and reject changed, missing or escaping resources', async () => {
    const name = '0005_materias_empty.sql';
    const bytes = await readFile(join('migrations/resources', name));
    const ref = {kind: 'check', name, contentHash: sha256Hex(bytes)};
    assert.equal(value(await migrationAuthoring.readSql(ref)), bytes.toString('utf8'));
    const changed = await migrationAuthoring.readSql({...ref, contentHash: '0'.repeat(64)});
    assert.equal(changed.ok, false);
    assert.equal(changed.problems[0].messageKey, 'migration.checksumMismatch');
    for (const name of ['missing.sql', '../baseline.json']) {
        assert.equal((await migrationAuthoring.readSql({...ref, name})).ok, false);
    }
});

test('the current SSOT migration state survives canonical JSON serialization, including composite FKs', async () => {
    const system = value(decodeSqlSsot(ssot, sqlMapping));
    const state = value(await captureMigrationState(system, 'ssot', 'roundtrip'));
    assert.deepEqual(value(await readStateBytes(jsonBytes(state))), state);
});

test('migration artifacts retain valid hashes and grant CRUD only when their tables are created', async () => {
    const root = 'migrations';
    const catalog = value(await readStoredCatalog(root));
    const expected = {
        '0001_initial': ['materias', 'pabellones', 'planes'],
        '0002_authentication': ['usuarios'],
        '0003_authenticated_administrators': [],
        '0004_materias_plan_fk': [],
    };
    for (let index = 0; index < catalog.releases.length; index++) value(await readCatalogState(root, catalog, index));
    for (const published of catalog.migrations) {
        const verified = value(await verifyMigrationFiles(migrationDirectory(root, published), published));
        const text = await readFile(join(migrationDirectory(root, published), verified.manifest.script.path), 'utf8');
        const tables = [...text.matchAll(/GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ssot"\."([^"]+)" TO "ssot2026_user";/g)].map(match => match[1]).sort();
        assert.deepEqual(tables, expected[published.migration.id]);
        assert.doesNotMatch(text, /^--/m);
        assert.doesNotMatch(text, /ALTER DEFAULT PRIVILEGES[^;]+\bGRANT\b/);
        assert.equal(published.migration.steps.some(step => step.id === 'app-permissions'), tables.length > 0);
        if (published.migration.id === '0001_initial') assert.match(text, /ALTER DEFAULT PRIVILEGES[^;]+\bREVOKE\b/);
    }
});

test('the plan FK migration only changes the constraint and leaves existing data untouched', async () => {
    const text = await readFile('migrations/entries/0004_materias_plan_fk/0004_materias_plan_fk.sql', 'utf8');
    assert.match(text, /FOREIGN KEY \("plan"\) REFERENCES "ssot"\."planes" \("plan"\)/);
    assert.doesNotMatch(text, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CASCADE|NOT VALID)\b/i);
});

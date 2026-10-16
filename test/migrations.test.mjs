import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {migrationDirectory, readCatalogState, readStoredCatalog, verifyMigrationFiles} from '@system-definition/postgres-migrations';

const value = result => { if (!result.ok) throw new Error(JSON.stringify(result.problems)); return result.value; };

test('migration artifacts retain valid hashes and grant CRUD only when their tables are created', async () => {
    const root = 'migrations';
    const catalog = value(await readStoredCatalog(root));
    const expected = {
        '0001_initial': ['materias', 'pabellones', 'planes'],
        '0002_authentication': ['usuarios'],
        '0003_authenticated_administrators': [],
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

import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {withTestDatabase} from './helpers/database.mjs';
import {initializeUsers} from '../dist/backend/bootstrap.js';
import {createAuthentication} from '../dist/backend/auth.js';
import {registerEntityApi} from '../dist/backend/api.js';
import {parseCsv, stringifyCsv} from '../dist/backend/csv.js';
import {csvSettings} from '../dist/backend/csv-settings.js';

test('CSV imports use real transactions, SSOT constraints and authenticated API capabilities', {timeout: 60000}, async t => {
    await withTestDatabase(async ({pool}) => {
        await initializeUsers(pool, {username: 'csv-admin', password: 'csv-test-long-password'});
        const app = express(), auth = createAuthentication(pool, 'csv-test-secret-with-at-least-32-bytes');
        const changes = [];
        registerEntityApi(app, pool, auth, name => changes.push(name));
        const server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
        const base = `http://127.0.0.1:${server.address().port}/api/entities`;
        const user = (await pool.query('SELECT id, usuario, version_sesion FROM ssot.usuarios')).rows[0];
        const token = (await auth.issueToken(user)).token;
        const request = (path, text) => fetch(base + path, {method: text === undefined ? 'GET' : 'POST',
            headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'text/csv'}, ...(text === undefined ? {} : {body: text})});
        const students = rows => stringifyCsv([['Legajo', 'Nombre'], ...rows]);
        try {
            await t.test('capabilities and routes enforce visibility, authentication and upload size', async () => {
                assert.equal((await fetch(`${base}/estudiantes/csv`)).status, 401);
                const users = await (await request('/usuarios')).json();
                assert.deepEqual(users.csv, {export: true, import: false, maxBytes: csvSettings.maxBytes});
                assert.deepEqual(parseCsv(await (await request('/usuarios/csv')).text()), [['Usuario'], ['csv-admin']]);
                assert.equal((await request('/usuarios/csv', 'Usuario\ncsv-admin')).status, 403);
                assert.equal((await request('/estudiantes/csv', '')).status, 400);
                assert.equal((await request('/estudiantes/csv', 'x'.repeat(csvSettings.maxBytes + 1))).status, 413);
                assert.deepEqual(changes, []);
            });
            await t.test('full exports round-trip text, null and SQL-looking values despite paging', async () => {
                const rows = [['empty', ''], ['null', null], ['unicode', 'Álgebra 😀, "hola"\nOtra línea'], ["'; DROP TABLE ssot.estudiantes; --", 'data']];
                const response = await request('/estudiantes/csv', students(rows));
                assert.equal(response.status, 200, await response.clone().text());
                assert.deepEqual(await response.json(), {inserted: 4, unchanged: 0});
                assert.deepEqual(changes.splice(0), ['estudiantes']);
                await pool.query("INSERT INTO ssot.estudiantes (legajo, nombre) SELECT 'sentinel-' || i, 'Unchanged' FROM generate_series(1,201) i");
                assert.equal((await (await request('/estudiantes')).json()).window.kind, 'page');
                const exported = await request('/estudiantes/csv');
                assert.match(exported.headers.get('content-type'), /text\/csv/);
                const csv = await exported.text();
                assert.equal(parseCsv(csv).length, 206);
                assert.deepEqual(await (await request('/estudiantes/csv', csv)).json(), {inserted: 0, unchanged: 205});
                assert.deepEqual(changes, []);
                assert.equal((await pool.query("SELECT nombre FROM ssot.estudiantes WHERE legajo = 'empty'")).rows[0].nombre, '');
                assert.equal((await pool.query("SELECT nombre FROM ssot.estudiantes WHERE legajo = 'null'")).rows[0].nombre, null);
            });
            await t.test('conflicts roll back earlier inserts without publishing changes', async () => {
                const response = await request('/estudiantes/csv', students([['new-before-conflict', 'new'], ['empty', 'changed']]));
                assert.equal(response.status, 409);
                assert.equal((await pool.query("SELECT 1 FROM ssot.estudiantes WHERE legajo = 'new-before-conflict'")).rowCount, 0);
                assert.deepEqual(changes, []);
            });
            await t.test('simultaneous identical imports insert once; different data never overwrites', async () => {
                const csv = students([['concurrent', 'same']]);
                const responses = await Promise.all([request('/estudiantes/csv', csv), request('/estudiantes/csv', csv)]);
                assert.deepEqual(responses.map(r => r.status), [200, 200]);
                const results = await Promise.all(responses.map(r => r.json()));
                assert.equal(results.reduce((sum, r) => sum + r.inserted, 0), 1);
                assert.deepEqual(changes.splice(0), ['estudiantes']);
                const conflicting = await Promise.all(['first', 'second'].map(value => request('/estudiantes/csv', students([['contested', value]]))));
                assert.deepEqual(conflicting.map(r => r.status).sort(), [200, 409]);
                assert.deepEqual(changes.splice(0), ['estudiantes']);
            });
            await t.test('composite keys, foreign keys, booleans and entity validators follow the SSOT', async () => {
                await pool.query("INSERT INTO ssot.departamentos (cod_dep, departamento) VALUES ('DC', 'Computación')");
                await pool.query("INSERT INTO ssot.planes (plan, descripcion) VALUES (1993, 'Plan viejo')");
                const headers = parseCsv(await (await request('/materias/csv')).text())[0];
                const valid = ['ALG', 'DC', 'Álgebra', 1993, false];
                assert.deepEqual(await (await request('/materias/csv', stringifyCsv([headers, valid]))).json(), {inserted: 1, unchanged: 0});
                const csv = await (await request('/materias/csv')).text();
                assert.deepEqual(await (await request('/materias/csv', csv)).json(), {inserted: 0, unchanged: 1});
                changes.length = 0;
                const invalidReference = await request('/materias/csv', stringifyCsv([headers, ['NEW', 'DC', null, null, null], ['BAD', 'missing', null, null, null]]));
                assert.equal(invalidReference.status, 400);
                assert.equal((await pool.query("SELECT 1 FROM ssot.materias WHERE cod_mat = 'NEW'")).rowCount, 0);
                assert.equal((await request('/materias/csv', stringifyCsv([headers, ['INVALID', 'DC', null, 1993, true]]))).status, 400);
                assert.deepEqual(changes, []);
            });
        } finally {
            const closed = new Promise(resolve => server.close(resolve));
            server.closeAllConnections();
            await closed;
        }
    });
});

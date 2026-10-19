import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import test from 'node:test';
import {initializeUsers} from '../dist/backend/bootstrap.js';
import {withTestDatabase} from './helpers/database.mjs';

// Adapted from PR #6: launch the actual server against an isolated current schema.
test('server startup, authenticated CRUD and atomic bulk deletion use the app connection', {timeout: 60000}, async t => {
    await withTestDatabase(async ({pool, config}) => {
        const password = 'crud-test-long-password';
        await initializeUsers(pool, {username: 'crud-admin', password});
        const child = spawn(process.execPath, ['dist/backend/server.js'], {
            env: {...process.env, DATABASE_URL: config.connectionString ?? '', PGDATABASE: config.database,
                PGHOST: config.host, PGPORT: String(config.port), PGUSER: config.user, PGPASSWORD: config.password,
                PORT: '0', JWT_SECRET: 'crud-test-secret-with-at-least-32-bytes'},
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const exited = once(child, 'exit');
        try {
            const base = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Server startup timed out')), 15000);
                let output = '';
                child.stdout.on('data', chunk => {
                    output += chunk;
                    const match = output.match(/http:\/\/localhost:\d+/);
                    if (match) { clearTimeout(timer); resolve(match[0]); }
                });
                child.once('error', error => { clearTimeout(timer); reject(error); });
                child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited before startup: ${code}`)); });
            });
            let token;
            const request = (path, method = 'GET', body) => fetch(base + path, {method,
                headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
                ...(body === undefined ? {} : {body: JSON.stringify(body)}),
            });
            const send = (entity, method, body) => request(`/api/entities/${entity}`, method, body);
            await t.test('real entry point serves health, frontend and authenticated API', async () => {
                assert.deepEqual(await (await request('/health')).json(), {ok: true});
                assert.match(await (await request('/')).text(), /id="tabs"/);
                assert.equal((await request('/assets/main.js')).status, 200);
                assert.equal((await request('/api/entities')).status, 401);
                const login = await request('/api/auth/login', 'POST', {usuario: 'crud-admin', contrasena: password});
                assert.equal(login.status, 200);
                token = (await login.json()).token;
            });
            await t.test('CRUD preserves types, unrelated fields and composite keys', async () => {
                assert.equal((await send('departamentos', 'POST', {cod_dep: 'DC', departamento: 'Computación', pabellon: null})).status, 204);
                assert.equal((await send('planes', 'POST', {plan: 2026, descripcion: null})).status, 204);
                const row = {cod_mat: 'ALG', cod_dep: 'DC', materia: 'Algoritmos', plan: 2026, obligatoria: false};
                assert.equal((await send('materias', 'POST', row)).status, 204);
                assert.equal((await send('materias', 'POST', {...row, cod_mat: 'OTRA'})).status, 204);
                const changed = {...row, cod_mat: 'ALG2', materia: '', plan: null};
                assert.equal((await send('materias', 'PUT', {key: {cod_mat: 'ALG', cod_dep: 'DC'}, row: changed})).status, 204);
                const listed = await (await send('materias')).json();
                assert.deepEqual(listed.rows.find(value => value.cod_mat === 'ALG2'), changed);
                assert.deepEqual(listed.rows.find(value => value.cod_mat === 'OTRA'), {...row, cod_mat: 'OTRA'});
                assert.equal((await send('materias', 'DELETE', {cod_mat: 'ALG2', cod_dep: 'DC'})).status, 204);
                assert.equal((await send('materias', 'DELETE', {cod_mat: 'OTRA', cod_dep: 'DC'})).status, 204);
            });
            await t.test('dependency previews and failed batches preserve every selected row', async () => {
                for (const plan of [2027, 2028]) assert.equal((await send('planes', 'POST', {plan, descripcion: null})).status, 204);
                const row = {cod_mat: 'REF', cod_dep: 'DC', materia: null, plan: 2026, obligatoria: false};
                assert.equal((await send('materias', 'POST', row)).status, 204);
                const keys = [{plan: 2027}, {plan: 2026}];
                const preview = await (await send('planes/delete-check', 'POST', {keys})).json();
                assert.deepEqual(preview.blockers, [{entity: 'materias', relationship: 'plan', count: 1, keys: [{cod_mat: 'REF', cod_dep: 'DC'}]}]);
                assert.equal((await send('planes/bulk-delete', 'POST', {keys})).status, 409);
                assert.equal((await pool.query('SELECT count(*)::int AS count FROM ssot.planes')).rows[0].count, 3);
                assert.equal((await send('planes/bulk-delete', 'POST', {keys: [{plan: 2027}, {plan: -1}]})).status, 404);
                assert.equal((await pool.query('SELECT count(*)::int AS count FROM ssot.planes')).rows[0].count, 3);
                assert.equal((await send('planes/bulk-delete', 'POST', {keys: [{plan: 2027}, {plan: 2028}]})).status, 204);
                assert.deepEqual((await pool.query('SELECT plan FROM ssot.planes')).rows, [{plan: 2026}]);
            });
            await t.test('composite dependency previews and deletes follow the SSOT', async () => {
                assert.equal((await send('estudiantes', 'POST', {legajo: '1', nombre: 'Estudiante'})).status, 204);
                const enrollment = {legajo: '1', cod_mat: 'REF', cod_dep: 'DC', año: 2026, cuatrimestre: '1C', nota: null, regularidad: null};
                assert.equal((await send('enrolamientos', 'POST', enrollment)).status, 204);
                const keys = [{cod_mat: 'REF', cod_dep: 'DC'}];
                const preview = await (await send('materias/delete-check', 'POST', {keys})).json();
                assert.equal(preview.blockers[0].entity, 'enrolamientos');
                const {nota, regularidad, ...key} = enrollment;
                assert.deepEqual(preview.blockers[0].keys, [key]);
                assert.equal((await send('materias/bulk-delete', 'POST', {keys})).status, 409);
                assert.equal((await send('enrolamientos/bulk-delete', 'POST', {keys: [key]})).status, 204);
                assert.equal((await send('materias/bulk-delete', 'POST', {keys})).status, 204);
            });
        } finally {
            if (child.exitCode === null) child.kill();
            await exited;
        }
    });
});

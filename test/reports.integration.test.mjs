import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {withTestDatabase} from './helpers/database.mjs';
import {initializeUsers} from '../dist/backend/bootstrap.js';
import {createAuthentication, registerAuthApi} from '../dist/backend/auth.js';
import {registerEntityApi} from '../dist/backend/api.js';
import {completeEntity} from 'system-definition';
import {myContext, myEntities} from '../dist/backend/system.js';
import {reportDefinition} from '../dist/backend/reports.js';

test('report metadata follows field types and visibility in an arbitrary domain', () => {
    const base = completeEntity(myContext, myEntities.planes);
    const entity = {...base, name: 'inventory', fields: {
        warehouse: {...base.fields.descripcion, name: 'warehouse', label: 'Warehouse'},
        stock: {...base.fields.plan, name: 'stock', label: 'Stock'},
        secret: {...base.fields.plan, name: 'secret', readable: false},
        internal: {...base.fields.plan, name: 'internal', visible: false},
    }};
    const metadata = reportDefinition(entity, 'Inventory');
    assert.equal(metadata.name, 'inventory');
    assert.deepEqual(metadata.columns.map(({name, aggregates}) => [name, aggregates.map(({operation}) => operation)]), [
        ['warehouse', ['count', 'min', 'max']], ['stock', ['count', 'sum', 'avg', 'min', 'max']],
    ]);
});

test('reports authenticate, validate SSOT capabilities and paginate grouped PostgreSQL results', {timeout: 60000}, async t => {
    await withTestDatabase(async ({pool}) => {
        await initializeUsers(pool, {username: 'reader', password: 'report-test-password'});
        await pool.query(`INSERT INTO ssot.planes (plan, descripcion)
            SELECT i, CASE WHEN i = 25 THEN NULL ELSE 'Group ' || lpad((i % 12)::text, 2, '0') END FROM generate_series(1,25) i`);
        const app = express(), auth = createAuthentication(pool, 'report-test-secret-with-at-least-32-bytes');
        registerAuthApi(app, pool, auth);
        registerEntityApi(app, pool, auth);
        const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
        const base = `http://127.0.0.1:${server.address().port}/api/entities`;
        const user = (await pool.query('SELECT id, usuario, version_sesion FROM ssot.usuarios')).rows[0];
        const {token} = await auth.issueToken(user);
        const request = (name, body, authorized = true) => fetch(`${base}/${name}/report`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: {'Content-Type': 'application/json', ...(authorized ? {Authorization: `Bearer ${token}`} : {})},
            ...(body === undefined ? {} : {body: JSON.stringify(body)}),
        });
        const report = async body => {
            const result = await request('planes', body);
            assert.equal(result.status, 200, await result.clone().text());
            return result.json();
        };
        try {
            await t.test('metadata exposes only readable visible fields and valid aggregates', async () => {
                assert.equal((await request('planes', undefined, false)).status, 401);
                assert.equal((await request('planes', {groupBy: [], measures: [{operation: 'count'}]}, false)).status, 401);
                const users = await (await request('usuarios')).json();
                assert.deepEqual(users.columns.map(column => column.name), ['usuario']);
                const subjects = await (await request('materias')).json();
                assert.deepEqual(subjects.columns.find(column => column.name === 'obligatoria').aggregates.map(value => value.operation), ['count']);
            });
            await t.test('grouped pages have stable order, null groups and clamped page numbers', async () => {
                const query = {groupBy: ['descripcion'], measures: [{operation: 'count'}, {operation: 'sum', field: 'plan'}]};
                const first = await report(query), last = await report({...query, page: 99});
                assert.equal(first.total, 13);
                assert.equal(first.rows.length, 10);
                assert.equal(last.page, 2);
                assert.equal(last.rows.length, 3);
                assert.deepEqual(first.rows[0], {g0: 'Group 00', m0: '2', m1: '36'});
                assert.deepEqual(last.rows.at(-1), {g0: null, m0: '1', m1: '25'});
                assert.equal(new Set([...first.rows, ...last.rows].map(row => row.g0)).size, 13);
            });
            await t.test('counts, averages and extrema preserve null and numeric semantics', async () => {
                const result = await report({groupBy: [], measures: [{operation: 'count'}, {operation: 'count', field: 'descripcion'},
                    {operation: 'avg', field: 'plan'}, {operation: 'min', field: 'plan'}, {operation: 'max', field: 'plan'}]});
                assert.deepEqual(result.rows[0], {m0: '25', m1: '24', m2: '13.0000000000000000', m3: '1', m4: '25'});
                const empty = await report({groupBy: [], measures: [{operation: 'count'}, {operation: 'sum', field: 'plan'}], where: {plan: -1}});
                assert.deepEqual(empty.rows, [{m0: '0', m1: null}]);
                assert.deepEqual((await report({groupBy: ['descripcion'], measures: [], where: {descripcion: null}})).rows, [{g0: null}]);
            });
            await t.test('filters apply before grouping and SQL-looking values remain data', async () => {
                const filtered = await report({groupBy: ['descripcion'], measures: [{operation: 'count'}], filter: 'Group 01'});
                assert.deepEqual(filtered.rows, [{g0: 'Group 01', m0: '2'}]);
                const literal = await report({groupBy: [], measures: [{operation: 'count'}], where: {descripcion: "' OR 1=1; --"}});
                assert.deepEqual(literal.rows, [{m0: '0'}]);
            });
            await t.test('unknown/private fields, unsupported operations and malformed requests are rejected', async () => {
                for (const body of [
                    {groupBy: ['contrasena_hash'], measures: []},
                    {groupBy: [], measures: [{operation: 'sum', field: 'usuario'}]},
                    {groupBy: [], measures: [{operation: 'count', field: 'id'}]},
                    {groupBy: [], measures: [{operation: 'pg_sleep', field: 'usuario'}]},
                    {groupBy: ['usuario); DROP TABLE usuarios;--'], measures: []},
                    {groupBy: [], measures: [{operation: 'count'}], where: {contrasena_hash: 'x'}},
                    {groupBy: [], measures: [{operation: 'count'}], page: 0},
                    {groupBy: ['usuario', 'usuario'], measures: []},
                    {groupBy: [], measures: [{operation: 'count'}, {operation: 'count'}]},
                    {groupBy: [], measures: [{operation: 'sum'}]},
                    {groupBy: [], measures: []},
                ]) assert.equal((await request('usuarios', body)).status, 400, JSON.stringify(body));
                assert.equal((await pool.query('SELECT count(*)::int AS count FROM ssot.usuarios')).rows[0].count, 1);
            });
        } finally {
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
        }
    });
});

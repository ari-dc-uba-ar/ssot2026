import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {withTestDatabase} from './helpers/database.mjs';
import {initializeUsers} from '../dist/backend/bootstrap.js';
import {createAuthentication, registerAuthApi} from '../dist/backend/auth.js';
import {registerEntityApi} from '../dist/backend/api.js';
import {completeEntity} from 'system-definition';
import {myContext, myEntities} from '../dist/backend/system.js';
import {reportDefinition, runReport} from '../dist/backend/reports.js';
import {createReportCatalog} from '../dist/backend/report-joins.js';
import {databaseSettings} from '../dist/backend/database.js';
import {quotePgIdentifier} from '@system-definition/postgres-migrations';
import {removeReportJoin} from '../dist/frontend/report-joins.js';

test('removing a join removes only its descendants and reindexes surviving branches', () => {
    const join = (source, relationship) => ({source, relationship, kind: 'left'});
    const joins = [join(0, 'a'), join(1, 'b'), join(0, 'c'), join(2, 'd'), join(3, 'e')];
    assert.deepEqual(removeReportJoin(joins, 1), [join(0, 'c'), join(1, 'e')]);
    assert.deepEqual(removeReportJoin(joins, 2), [join(0, 'a'), join(0, 'c'), join(2, 'e')]);
    assert.equal(joins.length, 5);
});

test('self-joins distinguish two roles and never expose unreadable keys through metadata', async () => {
    await withTestDatabase(async ({pool, handle}) => {
        const base = completeEntity(myContext, myEntities.planes);
        const integer = (name, nullable = false) => ({...base.fields.plan, name, label: name, nullable});
        const people = {...base, name: 'people', pk: ['id'], fields: {
            id: {...integer('id'), visible: false}, manager: integer('manager', true), mentor: integer('mentor', true),
            name: {...base.fields.descripcion, name: 'name', label: 'Name'},
        }, fks: {manager: {entity: 'people', fields: {manager: 'id'}}, mentor: {entity: 'people', fields: {mentor: 'id'}}}};
        const catalog = createReportCatalog(new Map([['people', people]]), {people: 'People'});
        const metadata = reportDefinition(people, catalog);
        const manager = {source: 0, relationship: metadata.sources[0].relationships.find(edge => edge.id === JSON.stringify(['out', 'people', 'manager'])).id, kind: 'left'};
        const mentor = {...manager, relationship: JSON.stringify(['out', 'people', 'mentor'])};
        assert.equal(metadata.sources[0].relationships.length, 4, 'Both outgoing and incoming directions are available');
        assert.equal(metadata.sources[0].distinctRecords, true, 'Readable hidden keys may identify records without exposing key values');
        await handle.session.query(`CREATE TABLE ssot.people (id integer PRIMARY KEY, manager integer REFERENCES ssot.people, mentor integer REFERENCES ssot.people, name text)`, []);
        await handle.session.query(`GRANT SELECT, INSERT ON ssot.people TO ${quotePgIdentifier(databaseSettings.appUser.user)}`, []);
        await pool.query("INSERT INTO ssot.people VALUES (1,NULL,NULL,'Alice'), (2,1,3,'Bob'), (3,1,1,'Carol')");
        const joins = [manager, mentor];
        const result = await runReport(pool, people, {joins, groupBy: [0, 1, 2].map(source => JSON.stringify([source, 'name'])),
            measures: [0, 1, 2].map(source => ({operation: 'countDistinct', source}))}, catalog);
        assert.deepEqual(result.rows, [
            {g0: 'Alice', g1: null, g2: null, m0: '1', m1: '0', m2: '0'},
            {g0: 'Bob', g1: 'Alice', g2: 'Carol', m0: '1', m1: '1', m2: '1'},
            {g0: 'Carol', g1: 'Alice', g2: 'Alice', m0: '1', m1: '1', m2: '1'},
        ]);
        const privateKey = {...people, fields: {...people.fields, id: {...people.fields.id, readable: false}}};
        const privateCatalog = createReportCatalog(new Map([['people', privateKey]]), {people: 'People'});
        const privateMetadata = reportDefinition(privateKey, privateCatalog);
        assert.equal(privateMetadata.sources[0].distinctRecords, false);
        assert.deepEqual(privateMetadata.sources[0].relationships, []);
        await assert.rejects(runReport(pool, privateKey, {groupBy: [], measures: [{operation: 'countDistinct', source: 0}]}, privateCatalog), {status: 400});
        await assert.rejects(runReport(pool, privateKey, {joins, groupBy: [], measures: [{operation: 'count'}]}, privateCatalog), {status: 400});
        const hiddenSource = {...people, fields: {...people.fields, manager: {...people.fields.manager, readable: false}}};
        const hiddenCatalog = createReportCatalog(new Map([['people', hiddenSource]]), {people: 'People'});
        assert.equal(reportDefinition(hiddenSource, hiddenCatalog).sources[0].relationships.length, 2);
    });
});

test('report metadata follows field types and visibility in an arbitrary domain', () => {
    const base = completeEntity(myContext, myEntities.planes);
    const entity = {...base, name: 'inventory', fields: {
        warehouse: {...base.fields.descripcion, name: 'warehouse', label: 'Warehouse'},
        stock: {...base.fields.plan, name: 'stock', label: 'Stock'},
        secret: {...base.fields.plan, name: 'secret', readable: false},
        internal: {...base.fields.plan, name: 'internal', visible: false},
    }};
    const metadata = reportDefinition(entity, createReportCatalog(new Map([[entity.name, entity]]), {inventory: 'Inventory'}));
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
        const joinedReport = async (name, body) => {
            const response = await request(name, body);
            assert.equal(response.status, 200, await response.clone().text());
            return response.json();
        };
        const definition = async (name, joins = []) => {
            const response = await fetch(`${base}/${name}/report/definition`, {method: 'POST',
                headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`}, body: JSON.stringify({joins})});
            assert.equal(response.status, 200, await response.clone().text());
            return response.json();
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
            await t.test('SSOT paths support composite N:M joins, left joins and explicit distinct-record counts', async () => {
                await pool.query("INSERT INTO ssot.departamentos (cod_dep, departamento) VALUES ('D1', 'First'), ('D2', 'Second')");
                await pool.query("INSERT INTO ssot.materias (cod_mat, cod_dep, materia) VALUES ('M1', 'D1', 'First subject'), ('M1', 'D2', 'Second subject'), ('M2', 'D1', 'Empty subject')");
                await pool.query("INSERT INTO ssot.estudiantes (legajo, nombre) VALUES ('A', 'Alice'), ('B', 'Bob'), ('C', 'Carol')");
                await pool.query(`INSERT INTO ssot.enrolamientos (legajo, cod_mat, cod_dep, año, cuatrimestre, nota) VALUES
                    ('A','M1','D1',2026,'1C',8), ('A','M1','D1',2026,'2C',10), ('B','M1','D1',2026,'1C',6), ('B','M1','D2',2026,'1C',4)`);
                const root = await definition('estudiantes');
                const first = {source: 0, relationship: root.sources[0].relationships.find(edge => edge.entity === 'enrolamientos').id, kind: 'inner'};
                const middle = await definition('estudiantes', [first]);
                const second = {source: 1, relationship: middle.sources[1].relationships.find(edge => edge.entity === 'materias').id, kind: 'inner'};
                const joins = [first, second];
                const measures = [{operation: 'count'}, ...[0, 1, 2].map(source => ({operation: 'countDistinct', source})),
                    {operation: 'avg', field: JSON.stringify([1, 'nota'])}];
                assert.deepEqual((await joinedReport('estudiantes', {joins, groupBy: [], measures})).rows,
                    [{m0: '4', m1: '2', m2: '4', m3: '2', m4: '7.0000000000000000'}]);
                const left = joins.map(join => ({...join, kind: 'left'}));
                const grouped = await joinedReport('estudiantes', {joins: left, groupBy: [JSON.stringify([0, 'legajo'])], measures});
                assert.deepEqual(grouped.rows, [
                    {g0: 'A', m0: '2', m1: '1', m2: '2', m3: '1', m4: '9.0000000000000000'},
                    {g0: 'B', m0: '2', m1: '1', m2: '2', m3: '2', m4: '5.0000000000000000'},
                    {g0: 'C', m0: '1', m1: '1', m2: '0', m3: '0', m4: null},
                ]);
                const missing = await joinedReport('estudiantes', {joins: left, groupBy: [JSON.stringify([0, 'legajo'])], measures: [], where: {[JSON.stringify([1, 'legajo'])]: null}});
                assert.deepEqual(missing.rows, [{g0: 'C'}]);
                assert.equal((await joinedReport('estudiantes', {joins: [left[0], second], groupBy: [], measures: [{operation: 'count'}]})).rows[0].m0, '4');
                const repeated = await joinedReport('estudiantes', {joins: [first, first], groupBy: [],
                    measures: [{operation: 'count'}, {operation: 'countDistinct', source: 0}]});
                assert.deepEqual(repeated.rows, [{m0: '8', m1: '2'}]);
                const independent = await joinedReport('estudiantes', {joins: [first, first], groupBy: [], measures: [{operation: 'count'}],
                    where: {[JSON.stringify([1, 'cuatrimestre'])]: '2C', [JSON.stringify([2, 'cuatrimestre'])]: '1C'}});
                assert.deepEqual(independent.rows, [{m0: '1'}]);
                // More root records prove grouped join pagination, including unmatched records.
                await pool.query("INSERT INTO ssot.estudiantes (legajo, nombre) SELECT 'X' || n, 'Extra' FROM generate_series(1,12) n");
                const last = await joinedReport('estudiantes', {joins: left, groupBy: [JSON.stringify([0, 'legajo'])], measures: [], page: 99});
                assert.equal(last.total, 15);
                assert.equal(last.page, 2);
                assert.equal(last.rows.length, 5);
                for (const invalidJoins of [null, [{...first, source: 1}], [{...first, source: -1}], [{...first, source: 0.5}],
                    [{...first, kind: 'cross'}], [{...first, relationship: "'; DROP TABLE ssot.estudiantes; --"}], [{...first, on: '1=1'}]]) {
                    assert.equal((await request('estudiantes', {joins: invalidJoins, groupBy: [], measures: [{operation: 'count'}]})).status, 400);
                }
                for (const invalidMeasure of [{operation: 'countDistinct', source: 3}, {operation: 'countDistinct', source: -1},
                    {operation: 'countDistinct', source: 0, field: 'legajo'}, {operation: 'sum', field: 'legajo', source: 0}]) {
                    assert.equal((await request('estudiantes', {joins, groupBy: [], measures: [invalidMeasure]})).status, 400);
                }
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

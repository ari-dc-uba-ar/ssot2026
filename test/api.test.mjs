import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {registerEntityApi} from '../dist/backend/api.js';
import {myEntities, entityLabels} from '../dist/backend/system.js';
import {browsing} from '../dist/backend/browsing.js';
import {entityResult} from './helpers/entity-result.mjs';
import {createAuthentication} from '../dist/backend/auth.js';
import {appTypeBehaviours} from '../dist/backend/value-types.js';

const tokens = new Map();
const fetch = (url, options = {}) => globalThis.fetch(url, {...options,
    headers: {...options.headers, Authorization: `Bearer ${tokens.get(new URL(url).origin)}`},
});

async function startApi(t, query) {
    const app = express();
    const user = {id: 'admin', usuario: 'admin', version_sesion: 'test-version'};
    const auth = createAuthentication({query: async () => ({rows: [user]})}, 'test-only-secret-with-at-least-32-bytes');
    registerEntityApi(app, typeof query === 'function' ? {query, connect: async () => { throw new Error('Unexpected transaction'); }} : query, auth);
    const server = await new Promise(resolve => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    const base = `http://127.0.0.1:${server.address().port}`;
    tokens.set(base, (await auth.issueToken(user)).token);
    t.after(() => tokens.delete(base));
    return base;
}

test('entity discovery comes from the SSOT and needs no database query', async t => {
    const base = await startApi(t, () => { throw new Error('Unexpected database query'); });
    const response = await fetch(`${base}/api/entities`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), Object.keys(myEntities).map(name => ({name, label: entityLabels[name]})));
    for (const name of ['unknown', 'constructor', 'materias;DROP TABLE ssot.materias']) {
        const invalid = await fetch(`${base}/api/entities/${encodeURIComponent(name)}`);
        assert.equal(invalid.status, 404);
        assert.deepEqual(await invalid.json(), {error: 'Entidad desconocida'});
    }
});

test('entity data preserves JSON value types and exposes only display metadata', async t => {
    let sql;
    const base = await startApi(t, async text => {
        sql = text;
        return entityResult([{cod_mat: 'ALG', cod_dep: 'DM', materia: 'Álgebra', plan: 2026, obligatoria: false, private_extra: 'omit'}]);
    });
    const response = await fetch(`${base}/api/entities/materias`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        name: 'materias',
        label: 'Materias', browsing, window: {kind: 'complete'}, versions: ['1'],
        pk: ['cod_mat', 'cod_dep'],
        columns: [
            {name: 'cod_mat', label: 'cod mat', type: 'text', nullable: false, writable: true, constraints: {minLength: null, maxLength: null}},
            {name: 'cod_dep', label: 'cod dep', type: 'text', nullable: false, writable: true, constraints: {minLength: null, maxLength: null}},
            {name: 'materia', label: 'materia', type: 'text', nullable: true, writable: true, constraints: {minLength: null, maxLength: null}},
            {name: 'plan', label: 'plan', type: 'integer', nullable: true, writable: true, constraints: {minLength: null, maxLength: null}},
            {name: 'obligatoria', label: 'obligatoria', type: 'boolean', nullable: true, writable: true, constraints: {minLength: null, maxLength: null}},
        ],
        inputs: [
            {name: 'cod_mat', label: 'cod mat', type: 'text', nullable: false, constraints: {minLength: null, maxLength: null}, optionalOnUpdate: false},
            {name: 'cod_dep', label: 'cod dep', type: 'text', nullable: false, constraints: {minLength: null, maxLength: null}, optionalOnUpdate: false},
            {name: 'materia', label: 'materia', type: 'text', nullable: true, constraints: {minLength: null, maxLength: null}, optionalOnUpdate: false},
            {name: 'plan', label: 'plan', type: 'integer', nullable: true, constraints: {minLength: null, maxLength: null}, optionalOnUpdate: false},
            {name: 'obligatoria', label: 'obligatoria', type: 'boolean', nullable: true, constraints: {minLength: null, maxLength: null}, optionalOnUpdate: false},
        ],
        foreignKeys: [
            {name: 'plan', entity: 'planes', fields: {plan: 'plan'}, displayFields: ['plan', 'descripcion']},
            {name: 'departamento', entity: 'departamentos', fields: {cod_dep: 'cod_dep'}, displayFields: ['cod_dep', 'departamento']},
        ],
        rows: [{cod_mat: 'ALG', cod_dep: 'DM', materia: 'Álgebra', plan: 2026, obligatoria: false}],
    });
    assert.match(sql, /SELECT "cod_mat", "cod_dep", "materia", "plan", "obligatoria"/);
    assert.match(sql, /FROM "ssot"\."materias"/);
    assert.match(sql, /ORDER BY "cod_mat" COLLATE "C" asc NULLS LAST, "cod_dep" COLLATE "C" asc NULLS LAST/);
});

test('empty entities still return their columns', async t => {
    const base = await startApi(t, async () => entityResult([]));
    const response = await fetch(`${base}/api/entities/pabellones`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.name, 'pabellones');
    assert.deepEqual(body.rows, []);
    assert.deepEqual(body.columns.map(column => column.name), ['pab', 'pabellon', 'pisos']);
    assert.equal(body.columns[2].type, 'integer');
});

test('database errors and rows inconsistent with the SSOT return a JSON error', async t => {
    const rows = [
        {cod_mat: 'TEST', cod_dep: 'DC', materia: 'Wrong boolean', plan: null, obligatoria: 'true'},
        {cod_mat: null, cod_dep: 'DC', materia: null, plan: null, obligatoria: true},
        {materia: 'Missing nullable field', obligatoria: null},
    ];
    const base = await startApi(t, async () => {
        if (rows.length) return entityResult([rows.shift()]);
        throw new Error('Internal database details');
    });
    for (let index = 0; index < 4; index++) {
        const response = await fetch(`${base}/api/entities/materias`);
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), {error: 'No se pudieron procesar los datos.'});
    }
});

const send = (base, name, method, body) => fetch(`${base}/api/entities/${name}`, {
    method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
});

test('positive integers and enums validate parsed values without coercion', () => {
    const positive = appTypeBehaviours.posInteger;
    for (const value of [1, 2026]) {
        assert.equal(positive.check(value), true);
        assert.deepEqual(positive.deserialize(positive.serialize(value)), {ok: true, value});
    }
    for (const value of [0, -1, 1.5, NaN, Infinity, '1', true, null]) assert.equal(positive.check(value), false);
    for (const text of ['0', '-1', '1.5', '', 'Infinity', '9'.repeat(400)]) assert.equal(positive.deserialize(text).ok, false);
    for (const [type, values, invalid] of [
        ['regularidad', ['Libre', 'Regular'], ['libre', 'Regular ', '', 'Otro']],
        ['cuatrimestre', ['1C', '2C'], ['1', '3C', '1c', '']],
    ]) {
        const behaviour = appTypeBehaviours[type];
        for (const value of values) {
            assert.equal(behaviour.check(value), true);
            assert.deepEqual(behaviour.deserialize(behaviour.serialize(value)), {ok: true, value});
        }
        for (const text of invalid) {
            assert.equal(behaviour.check(text), false);
            assert.equal(behaviour.deserialize(text).ok, false);
        }
        assert.equal(behaviour.check(1), false);
    }
});

test('enrollment metadata supplies the positive minimum and enum choices to editors', async t => {
    const base = await startApi(t, async () => entityResult([]));
    const response = await fetch(`${base}/api/entities/enrolamientos`);
    assert.equal(response.status, 200);
    const {inputs} = await response.json();
    const input = name => inputs.find(column => column.name === name);
    assert.equal(input('año').type, 'posInteger');
    assert.equal(input('año').constraints.minimum, 1);
    assert.equal(input('año').nullable, false);
    assert.equal(input('cuatrimestre').type, 'cuatrimestre');
    assert.deepEqual(input('cuatrimestre').constraints.options, ['1C', '2C']);
    assert.equal(input('cuatrimestre').nullable, false);
    assert.equal(input('regularidad').type, 'regularidad');
    assert.deepEqual(input('regularidad').constraints.options, ['Libre', 'Regular']);
    assert.equal(input('regularidad').nullable, true);
});

const enrollment = {legajo: '123', cod_mat: 'ALG', cod_dep: 'DM', año: 2026, cuatrimestre: '1C', nota: null, regularidad: 'Libre'};
const enrollmentKey = row => Object.fromEntries(myEntities.enrolamientos.pk.map(name => [name, row[name]]));

test('invalid enrollment values and keys are rejected before querying on create, update and delete', async t => {
    let calls = 0;
    const base = await startApi(t, async () => { calls++; return {rowCount: 1}; });
    const key = enrollmentKey(enrollment);
    for (const [field, values] of [
        ['año', [0, -1, 1.5, '2026', null]],
        ['cuatrimestre', [1, '1', '3C', '1c', null]],
        ['regularidad', ['libre', 'Regular ', 'Otro', 1]],
    ]) {
        for (const value of values) {
            const row = {...enrollment, [field]: value};
            for (const [method, body] of [['POST', row], ['PUT', {key, row, version: '1'}]]) {
                const response = await send(base, 'enrolamientos', method, body);
                assert.equal(response.status, 400, `${method} ${field}=${value}`);
                assert.ok((await response.json()).problems.some(problem => problem.field === field));
            }
            if (field !== 'regularidad') {
                const invalidKey = {...key, [field]: value};
                assert.equal((await send(base, 'enrolamientos', 'DELETE', invalidKey)).status, 400);
                assert.equal((await send(base, 'enrolamientos', 'PUT', {key: invalidKey, row: enrollment, version: '1'})).status, 400);
            }
        }
    }
    assert.equal(calls, 0);
});

test('valid enrollment enums, positive year boundary and nullable regularidad retain their values', async t => {
    const queries = [];
    const base = await startApi(t, async (sql, values) => { queries.push({sql, values}); return {rowCount: 1}; });
    for (const regularidad of ['Libre', 'Regular', null]) {
        const row = {...enrollment, año: 1, regularidad};
        assert.equal((await send(base, 'enrolamientos', 'POST', row)).status, 204);
        assert.deepEqual(queries.at(-1).values, Object.values(row));
        const updated = {...row, cuatrimestre: '2C'};
        assert.equal((await send(base, 'enrolamientos', 'PUT', {key: enrollmentKey(row), row: updated, version: '1'})).status, 204);
        assert.deepEqual(queries.at(-1).values, [...Object.values(updated), ...Object.values(enrollmentKey(row)), '1']);
    }
});

test('CRUD uses parameters and targets the original key when the key is edited', async t => {
    const queries = [];
    const base = await startApi(t, async (sql, values) => { queries.push({sql, values}); return {rowCount: 1}; });
    const row = {cod_mat: '', cod_dep: 'DC', materia: "O'Reilly <script>", plan: 0, obligatoria: false};
    assert.equal((await send(base, 'materias', 'POST', row)).status, 204);
    assert.match(queries[0].sql, /^INSERT INTO "ssot"\."materias"/);
    assert.deepEqual(queries[0].values, ['', 'DC', row.materia, 0, false]);
    assert.ok(!queries[0].sql.includes(row.materia));
    assert.equal((await send(base, 'materias', 'PUT', {key: {cod_mat: '', cod_dep: 'DC'}, version: '1', row: {...row, cod_mat: 'RENAMED', materia: 'Renamed', plan: null}})).status, 204);
    assert.match(queries[1].sql, /WHERE "cod_mat" = \$6 AND "cod_dep" = \$7 AND xmin::text = \$8$/);
    assert.deepEqual(queries[1].values, ['RENAMED', 'DC', 'Renamed', null, false, '', 'DC', '1']);
    assert.equal((await send(base, 'materias', 'DELETE', {cod_mat: 'RENAMED', cod_dep: 'DC'})).status, 204);
    assert.match(queries[2].sql, /^DELETE FROM "ssot"\."materias" WHERE "cod_mat" = \$1 AND "cod_dep" = \$2$/);
    assert.deepEqual(queries[2].values, ['RENAMED', 'DC']);
    assert.equal((await send(base, 'planes', 'POST', {plan: 42, descripcion: null})).status, 204);
    assert.deepEqual(queries[3].values, [42, null]);
});

test('invalid shapes, types, keys and SSOT business rules fail before querying', async t => {
    let calls = 0;
    const base = await startApi(t, async () => { calls++; return {rowCount: 1}; });
    const row = {cod_mat: 'TEST', cod_dep: 'DC', materia: 'Test', plan: null, obligatoria: false};
    for (const body of [null, [], {}, {...row, cod_mat: null}, {...row, cod_dep: null}, {...row, plan: '2026'}, {...row, obligatoria: 'false'}, {...row, extra: true}, {...row, plan: 1993, obligatoria: true}]) {
        const response = await send(base, 'materias', 'POST', body);
        assert.equal(response.status, 400);
        assert.equal(typeof (await response.json()).error, 'string');
    }
    for (const key of [{}, {cod_mat: null, cod_dep: 'DC'}, {cod_mat: 'TEST'}, {cod_mat: 'TEST', cod_dep: 'DC', extra: true}]) {
        assert.equal((await send(base, 'materias', 'DELETE', key)).status, 400);
        assert.equal((await send(base, 'materias', 'PUT', {key, row, version: '1'})).status, 400);
    }
    assert.equal((await send(base, 'materias', 'PUT', row)).status, 400);
    assert.equal((await fetch(`${base}/api/entities/materias`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{'})).status, 400);
    assert.equal(calls, 0);
});

test('missing rows and constraint conflicts have useful, non-sensitive errors', async t => {
    const base = await startApi(t, async sql => {
        if (sql.startsWith('INSERT')) throw Object.assign(new Error('Internal query and credentials'), {code: '23505'});
        return {rowCount: 0};
    });
    assert.equal((await send(base, 'planes', 'PUT', {key: {plan: 1}, version: '1', row: {plan: 2, descripcion: null}})).status, 409);
    assert.equal((await send(base, 'planes', 'DELETE', {plan: 1})).status, 404);
    const conflict = await send(base, 'planes', 'POST', {plan: 1, descripcion: null});
    assert.equal(conflict.status, 409);
    assert.deepEqual(await conflict.json(), {error: 'Ya existe un registro con esa clave.'});
});

test('delete dependency checks report simple and composite SSOT foreign keys', async t => {
    const queries = [];
    const base = await startApi(t, async (sql, values) => {
        queries.push({sql, values});
        const dependentRows = sql.includes('FROM "ssot"."enrolamientos"')
            ? [{legajo: '123', cod_mat: 'ALG', cod_dep: 'DM', año: 2026, cuatrimestre: '1C'}]
            : [{cod_mat: 'ALG', cod_dep: 'DM'}];
        const count = sql.includes('FROM "ssot"."enrolamientos"') ? 2 : 1;
        return {rows: [{count, keys: dependentRows}]};
    });
    const composite = await fetch(`${base}/api/entities/materias/delete-check`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({keys: [{cod_mat: 'ALG', cod_dep: 'DM'}]}),
    });
    assert.equal(composite.status, 200);
    assert.deepEqual(await composite.json(), {
        blockers: [{
            entity: 'enrolamientos',
            relationship: 'materia',
            count: 2,
            keys: [{legajo: '123', cod_mat: 'ALG', cod_dep: 'DM', año: 2026, cuatrimestre: '1C'}],
        }],
    });
    assert.match(queries[0].sql, /LIMIT 10/);
    assert.match(queries[0].sql, /SELECT DISTINCT dependent\."legajo", dependent\."cod_mat", dependent\."cod_dep", dependent\."año", dependent\."cuatrimestre"/);
    assert.doesNotMatch(queries[0].sql, /SELECT DISTINCT dependent\.\*/);
    assert.match(queries[0].sql, /dependent\."cod_mat" = target\."cod_mat" AND dependent\."cod_dep" = target\."cod_dep"/);
    assert.deepEqual(queries[0].values, ['ALG', 'DM']);

    const simple = await fetch(`${base}/api/entities/planes/delete-check`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({keys: [{plan: 2026}]}),
    });
    assert.equal(simple.status, 200);
    assert.deepEqual(await simple.json(), {
        blockers: [{entity: 'materias', relationship: 'plan', count: 1, keys: [{cod_mat: 'ALG', cod_dep: 'DM'}]}],
    });
});

test('bulk delete rejects malformed and duplicate selections before querying', async t => {
    let calls = 0;
    const base = await startApi(t, async () => { calls++; return {rows: []}; });
    for (const keys of [[], [{plan: '2026'}], [{plan: 2026}, {plan: 2026}]]) {
        const response = await fetch(`${base}/api/entities/planes/bulk-delete`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({keys}),
        });
        assert.equal(response.status, 400);
    }
    assert.equal(calls, 0);
});

test('bulk delete rolls the whole selection back when any row has dependents', async t => {
    const statements = [];
    const client = {
        async query(sql) {
            statements.push(sql);
            if (sql === 'BEGIN' || sql === 'ROLLBACK') return {rowCount: null, rows: []};
            if (sql.includes('FOR UPDATE')) return {rowCount: 2, rows: [{cod_mat: 'ALG'}, {cod_mat: 'FIS'}]};
            if (sql.startsWith('WITH matching')) return {rows: [{count: 1, keys: [{legajo: '123'}]}]};
            if (sql.startsWith('DELETE')) return {rowCount: 2, rows: []};
            throw new Error('Unexpected query in bulk-delete test');
        },
        release() {},
    };
    const base = await startApi(t, {query: async () => ({rows: []}), connect: async () => client});
    const response = await fetch(`${base}/api/entities/materias/bulk-delete`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({keys: [{cod_mat: 'ALG', cod_dep: 'DM'}, {cod_mat: 'FIS', cod_dep: 'DM'}]}),
    });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /enrolamientos \(materia\): 1/);
    assert.ok(statements.includes('ROLLBACK'));
    assert.ok(!statements.some(sql => sql.startsWith('DELETE')));
});

test('bulk delete removes all selected rows in one transaction when unreferenced', async t => {
    const statements = [];
    const client = {
        async query(sql) {
            statements.push(sql);
            if (sql === 'BEGIN' || sql === 'COMMIT') return {rowCount: null, rows: []};
            if (sql.includes('FOR UPDATE')) return {rowCount: 2, rows: [{plan: 2026}, {plan: 2027}]};
            if (sql.startsWith('WITH matching')) return {rows: [{count: 0, keys: []}]};
            if (sql.startsWith('DELETE')) return {rowCount: 2, rows: [{plan: 2026}, {plan: 2027}]};
            throw new Error('Unexpected query in bulk-delete test');
        },
        release() {},
    };
    const base = await startApi(t, {query: async () => ({rows: []}), connect: async () => client});
    const response = await fetch(`${base}/api/entities/planes/bulk-delete`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({keys: [{plan: 2026}, {plan: 2027}]}),
    });
    assert.equal(response.status, 204);
    assert.ok(statements.includes('COMMIT'));
    assert.equal(statements.filter(sql => sql.startsWith('DELETE')).length, 1);
    assert.equal(statements.at(-1), 'COMMIT');
});

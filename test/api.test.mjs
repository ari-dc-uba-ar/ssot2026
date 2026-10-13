import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {registerEntityApi} from '../dist/backend/api.js';
import {myEntities} from '../dist/backend/system.js';

async function startApi(t, query) {
    const app = express();
    registerEntityApi(app, {query});
    const server = await new Promise(resolve => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    return `http://127.0.0.1:${server.address().port}`;
}

test('entity discovery comes from the SSOT and needs no database query', async t => {
    const base = await startApi(t, () => { throw new Error('Unexpected database query'); });
    const response = await fetch(`${base}/api/entities`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), Object.keys(myEntities));
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
        return {rows: [{cod_mat: null, materia: 'Álgebra', plan: 2026, obligatoria: false, private_extra: 'omit'}]};
    });
    const response = await fetch(`${base}/api/entities/materias`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        name: 'materias',
        pk: ['materia'],
        columns: [
            {name: 'cod_mat', label: 'cod mat', type: 'text', nullable: true},
            {name: 'materia', label: 'materia', type: 'text', nullable: false},
            {name: 'plan', label: 'plan', type: 'integer', nullable: true},
            {name: 'obligatoria', label: 'obligatoria', type: 'boolean', nullable: true},
        ],
        rows: [{cod_mat: null, materia: 'Álgebra', plan: 2026, obligatoria: false}],
    });
    assert.match(sql, /SELECT "cod_mat", "materia", "plan", "obligatoria"/);
    assert.match(sql, /FROM "ssot"\."materias"/);
    assert.match(sql, /ORDER BY "materia"/);
});

test('empty entities still return their columns', async t => {
    const base = await startApi(t, async () => ({rows: []}));
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
        {cod_mat: 'TEST', materia: 'Wrong boolean', plan: null, obligatoria: 'true'},
        {cod_mat: 'TEST', materia: null, plan: null, obligatoria: true},
        {materia: 'Missing nullable field', obligatoria: null},
    ];
    const base = await startApi(t, async () => {
        if (rows.length) return {rows: [rows.shift()]};
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

test('CRUD uses parameters and targets the original key when the key is edited', async t => {
    const queries = [];
    const base = await startApi(t, async (sql, values) => { queries.push({sql, values}); return {rowCount: 1}; });
    const row = {cod_mat: '', materia: "O'Reilly <script>", plan: 0, obligatoria: false};
    assert.equal((await send(base, 'materias', 'POST', row)).status, 204);
    assert.match(queries[0].sql, /^INSERT INTO "ssot"\."materias"/);
    assert.deepEqual(queries[0].values, ['', row.materia, 0, false]);
    assert.ok(!queries[0].sql.includes(row.materia));
    assert.equal((await send(base, 'materias', 'PUT', {key: {materia: row.materia}, row: {...row, materia: 'Renamed', plan: null}})).status, 204);
    assert.match(queries[1].sql, /WHERE "materia" = \$5$/);
    assert.deepEqual(queries[1].values, ['', 'Renamed', null, false, row.materia]);
    assert.equal((await send(base, 'materias', 'DELETE', {materia: 'Renamed'})).status, 204);
    assert.match(queries[2].sql, /^DELETE FROM "ssot"\."materias" WHERE "materia" = \$1$/);
    assert.deepEqual(queries[2].values, ['Renamed']);
    assert.equal((await send(base, 'planes', 'POST', {plan: 42, descripcion: null})).status, 204);
    assert.deepEqual(queries[3].values, [42, null]);
});

test('invalid shapes, types, keys and SSOT business rules fail before querying', async t => {
    let calls = 0;
    const base = await startApi(t, async () => { calls++; return {rowCount: 1}; });
    const row = {cod_mat: null, materia: 'Test', plan: null, obligatoria: false};
    for (const body of [null, [], {}, {...row, materia: null}, {...row, plan: '2026'}, {...row, obligatoria: 'false'}, {...row, extra: true}, {...row, plan: 1993, obligatoria: true}]) {
        const response = await send(base, 'materias', 'POST', body);
        assert.equal(response.status, 400);
        assert.equal(typeof (await response.json()).error, 'string');
    }
    for (const key of [{}, {materia: null}, {materia: 'Test', extra: true}]) {
        assert.equal((await send(base, 'materias', 'DELETE', key)).status, 400);
        assert.equal((await send(base, 'materias', 'PUT', {key, row})).status, 400);
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
    assert.equal((await send(base, 'planes', 'PUT', {key: {plan: 1}, row: {plan: 2, descripcion: null}})).status, 404);
    assert.equal((await send(base, 'planes', 'DELETE', {plan: 1})).status, 404);
    const conflict = await send(base, 'planes', 'POST', {plan: 1, descripcion: null});
    assert.equal(conflict.status, 409);
    assert.deepEqual(await conflict.json(), {error: 'Ya existe un registro con esa clave.'});
});

import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {registerEntityApi} from '../dist/backend/api.js';

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
    assert.deepEqual(await response.json(), ['materias', 'pabellones']);
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
        return {rows: [{cod_mat: null, materia: 'Álgebra', obligatoria: false, private_extra: 'omit'}]};
    });
    const response = await fetch(`${base}/api/entities/materias`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        name: 'materias',
        columns: [
            {name: 'cod_mat', label: 'cod mat', type: 'text'},
            {name: 'materia', label: 'materia', type: 'text'},
            {name: 'obligatoria', label: 'obligatoria', type: 'boolean'},
        ],
        rows: [{cod_mat: null, materia: 'Álgebra', obligatoria: false}],
    });
    assert.match(sql, /SELECT "cod_mat", "materia", "obligatoria"/);
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
        {cod_mat: 'TEST', materia: 'Wrong boolean', obligatoria: 'true'},
        {cod_mat: 'TEST', materia: null, obligatoria: true},
        {materia: 'Missing nullable field', obligatoria: null},
    ];
    const base = await startApi(t, async () => {
        if (rows.length) return {rows: [rows.shift()]};
        throw new Error('Internal database details');
    });
    for (let index = 0; index < 4; index++) {
        const response = await fetch(`${base}/api/entities/materias`);
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), {error: 'No se pudieron cargar los datos.'});
    }
});

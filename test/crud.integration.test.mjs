import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import express from 'express';
import {Client} from 'pg';
import {databaseConfig} from '../dist/backend/database.js';
import {registerEntityApi} from '../dist/backend/api.js';

test('CRUD round trip uses the app connection and rolls back its test data', async t => {
    const client = new Client(databaseConfig);
    await client.connect();
    t.after(async () => { await client.query('ROLLBACK'); await client.end(); });
    await client.query('BEGIN');
    const app = express();
    registerEntityApi(app, client);
    const server = await new Promise(resolve => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    t.after(() => new Promise(resolve => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}/api/entities/materias`;
    const send = (method, body) => fetch(url, {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    const row = {materia: `crud-test-${randomUUID()}`, cod_mat: '', plan: 2026, obligatoria: false};
    assert.equal((await send('POST', row)).status, 204);
    let response = await (await fetch(url)).json();
    assert.deepEqual(response.rows.find(value => value.materia === row.materia), row);
    const changed = {...row, materia: row.materia + '-updated', cod_mat: null, obligatoria: true};
    assert.equal((await send('PUT', {key: {materia: row.materia}, row: changed})).status, 204);
    response = await (await fetch(url)).json();
    assert.deepEqual(response.rows.find(value => value.materia === changed.materia), changed);
    assert.ok(!response.rows.some(value => value.materia === row.materia));
    assert.equal((await send('DELETE', {materia: changed.materia})).status, 204);
    response = await (await fetch(url)).json();
    assert.ok(!response.rows.some(value => value.materia === changed.materia));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {completeEntity} from 'system-definition';
import {ApiFailure} from '../dist/backend/api-errors.js';
import {createAuthentication} from '../dist/backend/auth.js';
import {registerEntityApi} from '../dist/backend/api.js';
import {importEntityCsv, exportEntityCsv} from '../dist/backend/entity-csv.js';
import {myContext, myEntities} from '../dist/backend/system.js';

const entity = name => completeEntity(myContext, myEntities[name]);

function fakeDatabase(name, initial = []) {
    const records = new Map(initial.map(row => [JSON.stringify(myEntities[name].pk.map(field => row[field])), structuredClone(row)]));
    const snapshot = () => new Map([...records].map(([key, row]) => [key, structuredClone(row)]));
    const pool = {
        async query(sql) {
            assert.match(sql, /^SELECT /);
            return {rows: [...records.values()]};
        },
        async connect() {
            let before;
            return {
                async query(sql, values = []) {
                    if (sql === 'BEGIN') { before = snapshot(); return {rows: []}; }
                    if (sql === 'COMMIT') { before = undefined; return {rows: []}; }
                    if (sql === 'ROLLBACK') {
                        records.clear();
                        for (const [key, row] of before ?? []) records.set(key, row);
                        return {rows: []};
                    }
                    if (sql.startsWith('SELECT ')) {
                        if (sql.startsWith('SELECT 1 FROM ')) return {rows: []};
                        const selected = /^SELECT (.+?) FROM/.exec(sql)?.[1];
                        assert.ok(selected);
                        const fields = [...selected.matchAll(/"([^"]+)"/g)].map(match => match[1]);
                        const row = records.get(JSON.stringify(myEntities[name].pk.map((_, index) => values[index])));
                        return {rows: row ? [Object.fromEntries(fields.map(field => [field, row[field]]))] : []};
                    }
                    if (sql.startsWith('INSERT ')) {
                        const namesText = /^INSERT INTO .+? \((.+?)\) VALUES/.exec(sql)?.[1];
                        assert.ok(namesText);
                        const names = [...namesText.matchAll(/"([^"]+)"/g)].map(match => match[1]);
                        const row = Object.fromEntries(names.map((field, index) => [field, values[index]]));
                        const key = JSON.stringify(myEntities[name].pk.map(field => row[field]));
                        if (records.has(key)) return {rowCount: 0, rows: []};
                        records.set(key, row);
                        return {rowCount: 1, rows: [row]};
                    }
                    throw new Error(`Unexpected SQL: ${sql}`);
                },
                release() {},
            };
        },
    };
    return {pool, records};
}

test('exports every saved row with visible SSOT labels and RFC CSV escaping', async () => {
    const {pool} = fakeDatabase('estudiantes', [
        {legajo: 'E001', nombre: 'Nombre, "con coma"'},
        {legajo: 'E002', nombre: 'Otro'},
    ]);
    assert.equal(await exportEntityCsv(pool, entity('estudiantes')),
        '"Legajo","Nombre"\r\n"E001","Nombre, ""con coma"""\r\n"E002","Otro"\r\n');
});

test('exports only the username for users', async () => {
    const {pool} = fakeDatabase('usuarios', [{id: 'id-1', usuario: 'alumno', contrasena_hash: 'secret'}]);
    assert.equal(await exportEntityCsv(pool, entity('usuarios')), '"Usuario"\r\n"alumno"\r\n');
});

test('imports new records, treats identical existing and in-file duplicates as unchanged', async () => {
    const {pool, records} = fakeDatabase('estudiantes', [{legajo: 'E001', nombre: 'Ana'}]);
    const result = await importEntityCsv(pool, entity('estudiantes'),
        'Legajo,Nombre\r\nE001,Ana\r\nE001,Ana\r\nE002,Beto\r\nE002,Beto\r\n');
    assert.deepEqual(result, {inserted: 1, unchanged: 3});
    assert.equal(records.size, 2);
});

test('imports empty nullable cells as null', async () => {
    const {pool, records} = fakeDatabase('estudiantes');
    const result = await importEntityCsv(pool, entity('estudiantes'), 'Legajo,Nombre\r\nE001,\r\n');
    assert.deepEqual(result, {inserted: 1, unchanged: 0});
    assert.deepEqual([...records.values()], [{legajo: 'E001', nombre: null}]);
});

test('rolls back all new records when an existing primary key has different data', async () => {
    const {pool, records} = fakeDatabase('estudiantes', [{legajo: 'E001', nombre: 'Ana'}]);
    await assert.rejects(importEntityCsv(pool, entity('estudiantes'),
        'Legajo,Nombre\r\nE002,Beto\r\nE001,Otra\r\n'), error => {
        assert.ok(error instanceof ApiFailure);
        assert.equal(error.status, 409);
        assert.match(error.message, /«Legajo»="E001"/);
        return true;
    });
    assert.deepEqual([...records.values()], [{legajo: 'E001', nombre: 'Ana'}]);
});

test('rejects malformed or mismatched headers and invalid values before opening a transaction', async () => {
    let connected = false;
    const pool = {
        query: async () => ({rows: []}),
        connect: async () => { connected = true; throw new Error('Unexpected connection'); },
    };
    for (const csv of ['Legajo,Nombre\r\n"E001,Ana\r\n', 'legajo,Nombre\r\nE001,Ana\r\n', 'Legajo,Nombre extra\r\nE001,Ana\r\n']) {
        await assert.rejects(importEntityCsv(pool, entity('estudiantes'), csv), ApiFailure);
    }
    await assert.rejects(importEntityCsv(pool, entity('planes'), 'Plan,Descripción\r\nno-numero,Plan\r\n'), error => {
        assert.ok(error instanceof ApiFailure);
        assert.match(error.message, /columna «Plan»/);
        return true;
    });
    assert.equal(connected, false);
});

test('reports the visible source column when a foreign-key reference does not exist', async () => {
    const {pool} = fakeDatabase('enrolamientos');
    await assert.rejects(importEntityCsv(pool, entity('enrolamientos'),
        'Legajo,Código de materia,Código de departamento,Año,Cuatrimestre,Nota,Regularidad\r\nE001,ALG,DC,2026,1C,8,Regular\r\n'), error => {
        assert.ok(error instanceof ApiFailure);
        assert.match(error.message, /columna «Legajo»/);
        assert.match(error.message, /no existe/);
        return true;
    });
});

test('does not import users', async () => {
    let connected = false;
    const pool = {
        query: async () => ({rows: []}),
        connect: async () => { connected = true; throw new Error('Unexpected connection'); },
    };
    await assert.rejects(importEntityCsv(pool, entity('usuarios'), 'Usuario\r\nalumno\r\n'), error => {
        assert.ok(error instanceof ApiFailure);
        assert.equal(error.status, 403);
        return true;
    });
    assert.equal(connected, false);
});

test('CSV API routes download complete data and reject user imports', async t => {
    const {pool} = fakeDatabase('estudiantes', [{legajo: 'E001', nombre: 'Ana'}]);
    const app = express();
    const user = {id: 'admin', usuario: 'admin', version_sesion: 'test-version'};
    const auth = createAuthentication({query: async () => ({rows: [user]})}, 'test-only-secret-with-at-least-32-bytes');
    registerEntityApi(app, pool, auth);
    const server = await new Promise(resolve => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    const base = `http://127.0.0.1:${server.address().port}/api/entities`;
    const token = (await auth.issueToken(user)).token;
    const headers = {Authorization: `Bearer ${token}`};

    const exported = await fetch(`${base}/estudiantes/csv`, {headers});
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-type'), /text\/csv; charset=utf-8/);
    assert.equal(await exported.text(), '"Legajo","Nombre"\r\n"E001","Ana"\r\n');

    const rejected = await fetch(`${base}/usuarios/csv`, {
        method: 'POST',
        headers: {...headers, 'Content-Type': 'text/csv'},
        body: '"Usuario"\r\n"alumno"\r\n',
    });
    assert.equal(rejected.status, 403);
    assert.equal((await rejected.json()).error, 'No se permite importar usuarios.');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {withTestDatabase} from './helpers/database.mjs';
import {versionOf} from './helpers/version.mjs';
import {initializeUsers} from '../dist/backend/bootstrap.js';
import {createAuthentication, registerAuthApi} from '../dist/backend/auth.js';
import {registerEntityApi} from '../dist/backend/api.js';
import {registerEntityEvents} from '../dist/backend/entity-events.js';
import {entityPage} from '../dist/frontend/entity-query.js';

test('hybrid queries, concurrent saves and live events use the real database', {timeout: 60000}, async t => {
    await withTestDatabase(async ({pool}) => {
        await initializeUsers(pool, {username: 'reader', password: 'integration-reader-password'});
        const app = express(), auth = createAuthentication(pool, 'integration-query-secret-with-32-bytes');
        const publish = registerEntityEvents(app, auth);
        registerAuthApi(app, pool, auth);
        registerEntityApi(app, pool, auth, publish);
        const server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
        const base = `http://127.0.0.1:${server.address().port}`;
        const user = (await pool.query('SELECT id, usuario, version_sesion FROM ssot.usuarios')).rows[0];
        const token = (await auth.issueToken(user)).token;
        const request = (path, method = 'GET', body, signal, jwt = token) => fetch(base + path, {
            method, headers: {'Content-Type': 'application/json', Authorization: `Bearer ${jwt}`},
            ...(body === undefined ? {} : {body: JSON.stringify(body)}), ...(signal ? {signal} : {}),
        });
        const read = async (entity, query = {}) => {
            const response = await request(`/api/entities/${entity}?query=${encodeURIComponent(JSON.stringify(query))}`);
            assert.equal(response.status, 200, await response.clone().text());
            return response.json();
        };
        try {
            await t.test('200 rows are complete; 201 are bounded, with matching filter/sort/page semantics', async () => {
                await pool.query(`INSERT INTO ssot.planes (plan, descripcion) SELECT i, CASE i % 7 WHEN 0 THEN NULL WHEN 1 THEN 'Álgebra' WHEN 2 THEN 'álgebra' WHEN 3 THEN '100%_literal' WHEN 4 THEN '' WHEN 5 THEN '😀' ELSE 'Zulu' END FROM generate_series(1,200) i`);
                const small = await read('planes');
                assert.equal(small.window.kind, 'complete');
                assert.equal(small.rows.length, 200);
                assert.equal(small.versions.length, 200);
                await pool.query("INSERT INTO ssot.planes (plan, descripcion) VALUES (201, 'last')");
                const first = await read('planes');
                assert.deepEqual(first.window, {kind: 'page', total: 201, matched: 201, page: 1});
                assert.equal(first.rows.length, 10);
                const all = {...small, rows: [...small.rows, {plan: 201, descripcion: 'last'}], versions: [...small.versions, 'unused']};
                for (const query of [{page: 2}, {page: 999}, {filter: '%_'}, {filter: 'ÁL'}, {filter: 'missing'},
                    {sort: 'descripcion', direction: 'asc', page: 2}, {sort: 'descripcion', direction: 'desc', page: 3},
                    {sort: 'plan', direction: 'desc'}, {where: {plan: 201}}, {where: {descripcion: null}}, {where: {descripcion: ''}}]) {
                    const actual = await read('planes', query), expected = entityPage(all, query);
                    assert.deepEqual(actual.rows, expected.rows, JSON.stringify(query));
                    assert.equal(actual.window.matched, expected.matched);
                    assert.equal(actual.window.page, expected.page);
                }
                await pool.query('DELETE FROM ssot.planes WHERE plan = 201');
                assert.equal((await read('planes')).window.kind, 'complete');
            });
            await t.test('unknown/private fields, wrong filter types and unsafe pagination are rejected', async () => {
                for (const query of [{sort: 'contrasena_hash'}, {where: {version_sesion: 'x'}}, {page: 0}, {page: 1.5}, {page: 2 ** 40}, {direction: 'DROP TABLE'}, {unexpected: true}]) {
                    const response = await request(`/api/entities/usuarios?query=${encodeURIComponent(JSON.stringify(query))}`);
                    assert.equal(response.status, 400, JSON.stringify(query));
                }
                assert.equal((await request(`/api/entities/planes?query=${encodeURIComponent(JSON.stringify({where: {plan: '1'}}))}`)).status, 400);
            });
            await t.test('two users cannot save the same version; deletes and key changes also invalidate it', async () => {
                assert.equal((await request('/api/entities/usuarios', 'POST', {usuario: 'writer', contrasena: 'integration-writer-password'})).status, 204);
                const writer = (await pool.query("SELECT id, usuario, version_sesion FROM ssot.usuarios WHERE usuario='writer'")).rows[0];
                const writerToken = (await auth.issueToken(writer)).token;
                const key = {plan: 1}, version = versionOf(await read('planes'), key);
                const responses = await Promise.all([token, writerToken].map((jwt, i) => request('/api/entities/planes', 'PUT', {key, version, row: {plan: 1, descripcion: `writer ${i}`}}, undefined, jwt)));
                assert.deepEqual(responses.map(response => response.status).sort(), [204, 409]);
                const current = await read('planes');
                assert.notEqual(versionOf(current, key), version);
                const stale = await request('/api/entities/planes', 'PUT', {key, version, row: {plan: 1, descripcion: 'stale'}});
                assert.equal(stale.status, 409);
                assert.match((await stale.json()).error, /borrador/);
                assert.deepEqual((await read('planes')).rows, current.rows);
                assert.equal((await request('/api/entities/planes', 'PUT', {key, row: {plan: 1, descripcion: 'no version'}})).status, 400);
                await request('/api/entities/planes', 'DELETE', key);
                assert.equal((await request('/api/entities/planes', 'PUT', {key, version: versionOf(current, key), row: {plan: 1, descripcion: 'deleted'}})).status, 409);
            });
            await t.test('authenticated live subscribers receive committed mutations and reconnect invalidations', async () => {
                const abort = new AbortController();
                const stream = await request('/api/events', 'GET', undefined, abort.signal);
                const reader = stream.body.pipeThrough(new TextDecoderStream()).getReader();
                try {
                    assert.match((await reader.read()).value, /data: null/);
                    assert.equal((await request('/api/entities/planes', 'POST', {plan: 999, descripcion: 'live'})).status, 204);
                    assert.match((await reader.read()).value, /data: "planes"/);
                    assert.ok((await read('planes')).rows.some(row => row.plan === 999));
                } finally { abort.abort(); await reader.cancel().catch(() => {}); }
                const anonymous = await fetch(base + '/api/events');
                assert.equal(anonymous.status, 401);
            });
        } finally {
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
        }
    });
});

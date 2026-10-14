import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {spawnSync} from 'node:child_process';
import {Pool} from 'pg';
import {createPostgresScratch, decodeSqlSsot, generateCreate, projectSsotSchema, quotePgIdentifier as quote} from '@system-definition/postgres-migrations';
import {databaseConfig, databaseSettings} from '../dist/backend/database.js';
import {ssot, sqlMapping} from '../dist/backend/system.js';
import {createAuthentication, registerAuthApi} from '../dist/backend/auth.js';
import {registerEntityApi} from '../dist/backend/api.js';
import {insertUser} from '../dist/backend/users.js';
import {verifyPassword} from '../dist/backend/credentials.js';

const value = result => { if (!result.ok) throw new Error(JSON.stringify(result.problems)); return result.value; };
const password = 'initial-auth-test-password';

async function start(t) {
    const {schema} = databaseSettings.database;
    const scratch = createPostgresScratch({...databaseSettings.database, ...databaseSettings.initialUser}, [schema]);
    const handle = value(await scratch.create('clean-target'));
    let pool, server;
    t.after(async () => {
        if (server) await new Promise(resolve => server.close(resolve));
        await pool?.end();
        value(await scratch.destroy(handle));
    });
    const desired = value(projectSsotSchema(value(decodeSqlSsot(ssot, sqlMapping)), schema));
    for (const sql of value(generateCreate(desired)).statements) await handle.session.query(sql.text, sql.values);
    await handle.session.query(`GRANT USAGE ON SCHEMA ${quote(schema)} TO ${quote(databaseSettings.appUser.user)}`, []);
    await handle.session.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${quote(schema)} TO ${quote(databaseSettings.appUser.user)}`, []);
    const config = {...databaseConfig, database: handle.id};
    if (config.connectionString) {
        const url = new URL(config.connectionString);
        url.pathname = '/' + handle.id;
        config.connectionString = url.toString();
    }
    pool = new Pool(config);
    await insertUser(pool, {usuario: 'admin', activo: true, administrador: true}, password);
    const app = express();
    const auth = createAuthentication(pool, 'integration-test-secret-with-at-least-32-bytes');
    registerAuthApi(app, pool, auth);
    registerEntityApi(app, pool, auth);
    server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = (path, method = 'GET', body, token) => fetch(base + path, {method,
        headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    const login = async (usuario, contrasena = password) => {
        const response = await request('/api/auth/login', 'POST', {usuario, contrasena});
        assert.equal(response.status, 200);
        return response.json();
    };
    return {pool, request, login, config};
}

test('PostgreSQL: bootstrap command creates an administrator, shows recovery codes once and refuses to overwrite accounts', async t => {
    const {pool, config} = await start(t);
    const env = {...process.env, DATABASE_URL: config.connectionString, PGDATABASE: config.database,
        PGHOST: config.host, PGPORT: String(config.port), PGUSER: config.user, PGPASSWORD: config.password,
        AUTH_ADMIN_USERNAME: 'bootstrap-admin', AUTH_ADMIN_PASSWORD: password};
    const first = spawnSync(process.execPath, ['dist/backend/create-admin.js'], {env, encoding: 'utf8'});
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout.split(/\r?\n/).filter(line => /^[a-f0-9]{8}(?:-[a-f0-9]{8}){3}$/.test(line)).length, 8);
    const account = (await pool.query('SELECT administrador, activo, contrasena_hash, recuperacion_hashes FROM ssot.usuarios WHERE usuario = $1', ['bootstrap-admin'])).rows[0];
    assert.equal(account.administrador, true);
    assert.equal(account.activo, true);
    assert.equal(JSON.parse(account.recuperacion_hashes).length, 8);
    const again = spawnSync(process.execPath, ['dist/backend/create-admin.js'], {env: {...env, AUTH_ADMIN_PASSWORD: 'different-long-password'}, encoding: 'utf8'});
    assert.equal(again.status, 1);
    assert.equal(again.stdout, '');
    assert.equal((await pool.query('SELECT contrasena_hash FROM ssot.usuarios WHERE usuario = $1', ['bootstrap-admin'])).rows[0].contrasena_hash, account.contrasena_hash);
});

test('PostgreSQL: administrators manage users, passwords stay hidden, and account changes revoke JWTs', async t => {
    const {pool, request, login} = await start(t);
    const admin = await login('admin');
    const row = {usuario: 'regular', activo: true, administrador: false};
    assert.equal((await request('/api/entities/usuarios', 'POST', {...row, contrasena: password}, admin.token)).status, 204);
    const regular = await login('regular');
    assert.equal((await request('/api/entities/usuarios', 'GET', undefined, regular.token)).status, 403);
    assert.equal((await request('/api/entities/usuarios', 'POST', {...row, usuario: 'intruder', administrador: true, contrasena: password}, regular.token)).status, 403);
    const body = await (await request('/api/entities/usuarios', 'GET', undefined, admin.token)).json();
    assert.equal(body.rows.length, 2);
    assert.doesNotMatch(JSON.stringify(body), /contrasena|recuperacion|version_sesion/);
    const stored = (await pool.query('SELECT * FROM ssot.usuarios WHERE usuario = $1', ['regular'])).rows[0];
    assert.equal(await verifyPassword(password, stored.contrasena_hash), true);
    assert.equal((await request('/api/entities/usuarios', 'PUT', {key: {id: stored.id}, row: {...row, activo: false}}, admin.token)).status, 204);
    assert.equal((await request('/api/entities', 'GET', undefined, regular.token)).status, 401);
    assert.equal((await request('/api/auth/login', 'POST', {usuario: 'regular', contrasena: password})).status, 401);
    assert.equal((await request('/api/entities/usuarios', 'PUT', {key: {id: stored.id}, row}, admin.token)).status, 204);
    assert.equal((await pool.query('SELECT contrasena_hash FROM ssot.usuarios WHERE id = $1', [stored.id])).rows[0].contrasena_hash, stored.contrasena_hash);
    const resetPassword = 'reset-by-administrator-password';
    assert.equal((await request('/api/entities/usuarios', 'PUT', {key: {id: stored.id}, row: {...row, contrasena: resetPassword}}, admin.token)).status, 204);
    const reset = await login('regular', resetPassword);
    assert.equal((await request('/api/entities/usuarios', 'DELETE', {id: stored.id}, admin.token)).status, 204);
    assert.equal((await request('/api/entities', 'GET', undefined, reset.token)).status, 401);
    assert.equal((await request('/api/entities/usuarios', 'DELETE', {id: admin.user.id}, admin.token)).status, 409);
});

test('PostgreSQL: recovery is atomic and single-use, codes rotate, and password changes/logout revoke sessions', async t => {
    const {pool, request, login} = await start(t);
    const session = await login('admin');
    const generated = await request('/api/auth/recovery-codes', 'POST', {contrasena: password}, session.token);
    assert.equal(generated.status, 200);
    const {codes} = await generated.json();
    const stored = (await pool.query('SELECT recuperacion_hashes FROM ssot.usuarios WHERE usuario = $1', ['admin'])).rows[0];
    for (const code of codes) assert.ok(!stored.recuperacion_hashes.includes(code));
    const newPassword = 'recovered-long-password';
    assert.equal((await request('/api/auth/recover', 'POST', {usuario: 'admin', codigo: codes[0], contrasena: 'short'})).status, 400);
    const attempts = await Promise.all([1, 2].map(() => request('/api/auth/recover', 'POST', {usuario: 'admin', codigo: codes[0], contrasena: newPassword})));
    assert.deepEqual(attempts.map(r => r.status).sort(), [200, 401]);
    const recoveredCodes = (await attempts.find(r => r.status === 200).json()).codes;
    assert.equal(recoveredCodes.length, 8);
    for (const code of [codes[0], codes[1]]) assert.equal((await request('/api/auth/recover', 'POST', {usuario: 'admin', codigo: code, contrasena: password})).status, 401);
    assert.equal((await request('/api/entities', 'GET', undefined, session.token)).status, 401);
    assert.equal((await request('/api/auth/login', 'POST', {usuario: 'admin', contrasena: password})).status, 401);
    const recovered = await login('admin', newPassword);
    assert.equal((await request('/api/auth/password', 'POST', {contrasenaActual: password, contrasena: password}, recovered.token)).status, 401);
    assert.equal((await request('/api/entities', 'GET', undefined, recovered.token)).status, 200);
    const regenerated = await request('/api/auth/recovery-codes', 'POST', {contrasena: newPassword}, recovered.token);
    assert.equal(regenerated.status, 200);
    assert.equal((await request('/api/auth/recover', 'POST', {usuario: 'admin', codigo: recoveredCodes[0], contrasena: password})).status, 401);
    const changed = await request('/api/auth/password', 'POST', {contrasenaActual: newPassword, contrasena: password}, recovered.token);
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).codes.length, 8);
    assert.equal((await request('/api/entities', 'GET', undefined, recovered.token)).status, 401);
    const current = await login('admin');
    assert.equal((await request('/api/auth/logout', 'POST', {}, current.token)).status, 204);
    assert.equal((await request('/api/entities', 'GET', undefined, current.token)).status, 401);
});

test('PostgreSQL: concurrent administrator cross-demotions preserve an active administrator', async t => {
    const {pool, request, login} = await start(t);
    await insertUser(pool, {usuario: 'second-admin', activo: true, administrador: true}, password);
    const first = await login('admin'), second = await login('second-admin');
    const responses = await Promise.all([
        request('/api/entities/usuarios', 'PUT', {key: {id: second.user.id}, row: {usuario: 'second-admin', activo: true, administrador: false}}, first.token),
        request('/api/entities/usuarios', 'PUT', {key: {id: first.user.id}, row: {usuario: 'admin', activo: true, administrador: false}}, second.token),
    ]);
    assert.equal(responses.filter(r => r.status === 204).length, 1);
    assert.ok(responses.every(r => [204, 401, 403, 409].includes(r.status)));
    const {rows} = await pool.query('SELECT count(*)::integer AS admins FROM ssot.usuarios WHERE activo AND administrador');
    assert.equal(rows[0].admins, 1);
});

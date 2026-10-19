import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {assessSchema, createPostgresScratch, decodeSqlSsot, generateCreate, projectSsotSchema, quotePgIdentifier as quote} from '@system-definition/postgres-migrations';
import {databaseConfig, databaseSettings} from '../dist/backend/database.js';
import {ssot, sqlMapping} from '../dist/backend/system.js';
import {createAuthentication, registerAuthApi} from '../dist/backend/auth.js';
import {registerEntityApi} from '../dist/backend/api.js';
import {initializeUsers} from '../dist/backend/bootstrap.js';
import {hashPassword, verifyPassword} from '../dist/backend/credentials.js';
import {versionOf} from './helpers/version.mjs';

const value = result => { if (!result.ok) throw new Error(JSON.stringify(result.problems)); return result.value; };
const password = 'initial-auth-test-password';

async function start(t, {initialize = true, legacy = false} = {}) {
    const {schema} = databaseSettings.database;
    const scratch = createPostgresScratch({...databaseSettings.database, ...databaseSettings.initialUser}, [schema]);
    const handle = value(await scratch.create('clean-target'));
    let pool, server;
    t.after(async () => {
        if (server) await new Promise(resolve => server.close(resolve));
        await pool?.end();
        value(await scratch.destroy(handle));
    });
    const desired = legacy
        ? JSON.parse(await readFile('migrations/entries/0002_authentication/metadata.json', 'utf8'))['states/to.json'].schema
        : value(projectSsotSchema(value(decodeSqlSsot(ssot, sqlMapping)), schema));
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
    if (initialize) await initializeUsers(pool, {username: 'admin', password});
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
    return {pool, request, login, config, handle};
}

test('PostgreSQL: materia FKs accept existing plans and null, and reject missing plans and referenced key changes', async t => {
    const {request, login} = await start(t);
    const {token} = await login('admin');
    const send = (entity, method, body) => request(`/api/entities/${entity}`, method, body, token);
    assert.equal((await send('planes', 'POST', {plan: 0, descripcion: 'Inicial'})).status, 204);
    assert.equal((await send('departamentos', 'POST', {cod_dep: 'DC', departamento: null, pabellon: null})).status, 204);
    const row = {cod_mat: 'ALG', cod_dep: 'DC', materia: 'Con plan', plan: 0, obligatoria: false};
    const key = {cod_mat: row.cod_mat, cod_dep: row.cod_dep};
    assert.equal((await send('materias', 'POST', row)).status, 204);
    const metadata = await (await send('materias', 'GET')).json();
    const version = versionOf(metadata, key);
    const planVersion = versionOf(await (await send('planes', 'GET')).json(), {plan: 0});
    assert.deepEqual(metadata.foreignKeys.find(fk => fk.name === 'plan'), {name: 'plan', entity: 'planes', fields: {plan: 'plan'}, displayFields: ['plan', 'descripcion']});
    for (const response of [
        await send('materias', 'POST', {...row, cod_mat: 'MISSING', materia: 'Plan inexistente', plan: 2000}),
        await send('materias', 'PUT', {key, row: {...row, plan: 2000}, version}),
        await send('planes', 'DELETE', {plan: 0}),
        await send('planes', 'PUT', {key: {plan: 0}, row: {plan: 1, descripcion: 'Nuevo número'}, version: planVersion}),
    ]) assert.equal(response.status, 409, await response.text());
    assert.equal((await send('planes', 'PUT', {key: {plan: 0}, row: {plan: 0, descripcion: 'Descripción actualizada'}, version: planVersion})).status, 204);
    assert.equal((await send('materias', 'PUT', {key, row: {...row, plan: null}, version})).status, 204);
    assert.equal((await send('materias', 'POST', {...row, cod_mat: 'SIN', materia: 'Sin plan', plan: null})).status, 204);
    assert.equal((await send('planes', 'DELETE', {plan: 0})).status, 204);
});

test('PostgreSQL: the FK migration preserves data and rolls back when an existing plan is missing', async t => {
    const {handle} = await start(t, {initialize: false, legacy: true});
    await handle.session.query(await readFile('migrations/entries/0003_authenticated_administrators/0003_authenticated_administrators.sql', 'utf8'), []);
    await handle.session.query("INSERT INTO ssot.materias (materia, plan) VALUES ('Existing orphan', 2000)", []);
    const before = (await handle.session.query('SELECT * FROM ssot.materias', [])).rows;
    const sql = await readFile('migrations/entries/0004_materias_plan_fk/0004_materias_plan_fk.sql', 'utf8');
    await assert.rejects(handle.session.query(sql, []), error => error.code === '23503');
    await handle.session.query('ROLLBACK', []);
    assert.deepEqual((await handle.session.query('SELECT * FROM ssot.materias', [])).rows, before);
    assert.deepEqual((await handle.session.query('SELECT * FROM ssot.planes', [])).rows, []);
    await handle.session.query('UPDATE ssot.materias SET plan = NULL', []);
    await handle.session.query(sql, []);
    const target = JSON.parse(await readFile('migrations/entries/0004_materias_plan_fk/metadata.json', 'utf8'))['states/to.json'];
    assert.deepEqual(value(await assessSchema(value(decodeSqlSsot(target.ssot, target.persistence.representations.postgres)), databaseSettings.database.schema, handle.session)), {equal: true, differences: []});
});

test('PostgreSQL: cold start requires configured credentials and initializes once under concurrent starts', async t => {
    const {pool} = await start(t, {initialize: false});
    await assert.rejects(initializeUsers(pool, {username: undefined, password: undefined}), /AUTH_ADMIN_USERNAME/);
    assert.equal((await pool.query('SELECT count(*)::integer AS total FROM ssot.usuarios')).rows[0].total, 0);
    const starts = await Promise.all([1, 2].map(() => initializeUsers(pool, {username: 'ADMIN', password})));
    assert.equal(starts.filter(result => result.created).length, 1);
    assert.equal(starts.find(result => result.created).codes.length, 8);
    const before = (await pool.query('SELECT * FROM ssot.usuarios')).rows;
    assert.equal(before.length, 1);
    assert.equal(before[0].usuario, 'admin');
    assert.equal(await verifyPassword(password, before[0].contrasena_hash), true);
    assert.deepEqual(await initializeUsers(pool, {username: undefined, password: undefined}), {created: false});
    assert.deepEqual(await initializeUsers(pool, {username: 'another', password: 'another-initial-password'}), {created: false});
    assert.deepEqual((await pool.query('SELECT * FROM ssot.usuarios')).rows, before);
});

test('PostgreSQL: bootstrap command prints codes only on creation and is idempotent', async t => {
    const {pool, config} = await start(t, {initialize: false});
    const env = {...process.env, DATABASE_URL: config.connectionString, PGDATABASE: config.database,
        PGHOST: config.host, PGPORT: String(config.port), PGUSER: config.user, PGPASSWORD: config.password,
        AUTH_ADMIN_USERNAME: 'bootstrap-admin', AUTH_ADMIN_PASSWORD: password};
    const first = spawnSync(process.execPath, ['dist/backend/create-admin.js'], {env, encoding: 'utf8'});
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout.split(/\r?\n/).filter(line => /^[a-f0-9]{8}(?:-[a-f0-9]{8}){3}$/.test(line)).length, 8);
    const before = (await pool.query('SELECT * FROM ssot.usuarios')).rows;
    const again = spawnSync(process.execPath, ['dist/backend/create-admin.js'], {
        env: {...env, AUTH_ADMIN_USERNAME: 'another', AUTH_ADMIN_PASSWORD: 'different-long-password'}, encoding: 'utf8',
    });
    assert.equal(again.status, 0, again.stderr);
    assert.equal(again.stdout, '');
    assert.deepEqual((await pool.query('SELECT * FROM ssot.usuarios')).rows, before);
});

test('PostgreSQL: all authenticated accounts manage users with generic CRUD and account edits/deletions revoke JWTs', async t => {
    const {pool, request, login} = await start(t);
    const admin = await login('admin');
    assert.equal((await request('/api/entities/usuarios', 'POST', {usuario: 'second', contrasena: password}, admin.token)).status, 204);
    const second = await login('second');
    const body = await (await request('/api/entities/usuarios', 'GET', undefined, second.token)).json();
    assert.equal(body.rows.length, 2);
    assert.deepEqual(body.columns.map(column => column.name), ['id', 'usuario']);
    assert.deepEqual(body.inputs.map(column => column.type), ['text', 'password']);
    assert.doesNotMatch(JSON.stringify(body), /contrasena_hash|recuperacion_hashes|version_sesion|administrador|activo/);
    assert.equal((await request('/api/entities/usuarios', 'POST', {usuario: 'third', contrasena: password}, second.token)).status, 204);
    const stored = (await pool.query('SELECT * FROM ssot.usuarios WHERE usuario = $1', ['second'])).rows[0];
    assert.equal(await verifyPassword(password, stored.contrasena_hash), true);
    const userVersion = async () => versionOf(await (await request('/api/entities/usuarios', 'GET', undefined, admin.token)).json(), {id: stored.id});
    assert.equal((await request('/api/entities/usuarios', 'PUT', {key: {id: stored.id}, row: {usuario: 'renamed'}, version: await userVersion()}, admin.token)).status, 204);
    assert.equal((await request('/api/entities', 'GET', undefined, second.token)).status, 401);
    assert.equal((await pool.query('SELECT contrasena_hash FROM ssot.usuarios WHERE id = $1', [stored.id])).rows[0].contrasena_hash, stored.contrasena_hash);
    await login('renamed');
    const resetPassword = 'reset-by-another-account-password';
    assert.equal((await request('/api/entities/usuarios', 'PUT', {key: {id: stored.id}, row: {usuario: 'renamed', contrasena: resetPassword}, version: await userVersion()}, admin.token)).status, 204);
    const reset = await login('renamed', resetPassword);
    assert.equal((await pool.query('SELECT recuperacion_hashes FROM ssot.usuarios WHERE id = $1', [stored.id])).rows[0].recuperacion_hashes, '[]');
    assert.equal((await request('/api/entities/usuarios', 'DELETE', {id: stored.id}, admin.token)).status, 204);
    assert.equal((await request('/api/entities', 'GET', undefined, reset.token)).status, 401);
    assert.equal((await request('/api/entities/usuarios', 'DELETE', {id: admin.user.id}, admin.token)).status, 204);
    const third = await login('third');
    assert.equal((await request('/api/entities/usuarios', 'DELETE', {id: third.user.id}, third.token)).status, 204);
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
    assert.equal((await request('/api/auth/recovery-codes', 'POST', {contrasena: newPassword}, recovered.token)).status, 200);
    assert.equal((await request('/api/auth/recover', 'POST', {usuario: 'admin', codigo: recoveredCodes[0], contrasena: password})).status, 401);
    const changed = await request('/api/auth/password', 'POST', {contrasenaActual: newPassword, contrasena: password}, recovered.token);
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).codes.length, 8);
    assert.equal((await request('/api/entities', 'GET', undefined, recovered.token)).status, 401);
    const current = await login('admin');
    assert.equal((await request('/api/auth/logout', 'POST', {}, current.token)).status, 204);
    assert.equal((await request('/api/entities', 'GET', undefined, current.token)).status, 401);
});

test('PostgreSQL: the incremental migration removes roles/status while preserving accounts and their credentials', async t => {
    const {pool, handle, login} = await start(t, {initialize: false, legacy: true});
    const row = {id: 'legacy-account', usuario: 'legacy', contrasena_hash: await hashPassword(password), recuperacion_hashes: '[]', version_sesion: 'legacy-version'};
    await pool.query('INSERT INTO ssot.usuarios (id, usuario, contrasena_hash, recuperacion_hashes, version_sesion, administrador, activo) VALUES ($1, $2, $3, $4, $5, FALSE, FALSE)', Object.values(row));
    const metadata = JSON.parse(await readFile('migrations/entries/0003_authenticated_administrators/metadata.json', 'utf8'));
    const migration = metadata['migration.json'].migration;
    for (const step of migration.steps) {
        const resource = metadata['resources.json'].find(resource => resource.ref.name === step.run.name);
        await handle.session.query(resource.text, []);
    }
    assert.deepEqual((await pool.query('SELECT * FROM ssot.usuarios')).rows, [row]);
    const target = metadata['states/to.json'];
    assert.deepEqual(value(await assessSchema(value(decodeSqlSsot(target.ssot, target.persistence.representations.postgres)), databaseSettings.database.schema, handle.session)), {equal: true, differences: []});
    assert.deepEqual(await initializeUsers(pool, {username: undefined, password: undefined}), {created: false});
    await login('legacy');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {SignJWT, decodeJwt} from 'jose';
import {createAuthentication, registerAuthApi} from '../dist/backend/auth.js';
import {registerEntityApi} from '../dist/backend/api.js';
import {hashPassword, verifyPassword, createRecoveryCodes, hashRecoveryCode} from '../dist/backend/credentials.js';
import {myContext} from '../dist/backend/system.js';
import {entityResult} from './helpers/entity-result.mjs';

const secret = 'test-only-signing-key-with-at-least-32-bytes';
const password = 'test-password-with-enough-length';
const user = {id: 'admin-id', usuario: 'admin', version_sesion: 'version-1'};
const passwordHash = await hashPassword(password);

async function start(t, query = async sql => sql.startsWith('WITH stats') ? entityResult([user]) : {rows: [user], rowCount: 1}, connect) {
    const app = express();
    const pool = {query, connect};
    const auth = createAuthentication(pool, secret);
    registerAuthApi(app, pool, auth);
    registerEntityApi(app, pool, auth);
    const server = await new Promise(resolve => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    const token = (await auth.issueToken(user)).token;
    return {
        token, auth,
        request: (path, method = 'GET', body, jwt = token) => fetch(base + path, {method,
            headers: {'Content-Type': 'application/json', ...(jwt ? {Authorization: `Bearer ${jwt}`} : {})},
            ...(body === undefined ? {} : {body: JSON.stringify(body)}),
        }),
    };
}

test('passwords are salted, verifiable and never stored as plaintext; recovery codes have 128 random bits', async () => {
    const otherHash = await hashPassword(password);
    assert.notEqual(otherHash, passwordHash);
    assert.ok(!passwordHash.includes(password));
    assert.equal(await verifyPassword(password, passwordHash), true);
    assert.equal(await verifyPassword('wrong-password', passwordHash), false);
    assert.equal(await verifyPassword(password, 'malformed'), false);
    const {codes, hashes} = createRecoveryCodes();
    assert.equal(new Set(codes).size, 8);
    for (const code of codes) {
        assert.match(code, /^[a-f0-9]{8}(?:-[a-f0-9]{8}){3}$/);
        assert.ok(!hashes.includes(code));
        assert.ok(JSON.parse(hashes).includes(hashRecoveryCode(code)));
    }
});

test('JWT configuration rejects a missing/short signing secret', () => {
    assert.throws(() => createAuthentication({}, ''), /JWT_SECRET/);
    assert.throws(() => createAuthentication({}, 'short'), /JWT_SECRET/);
});

test('password inputs use the type behaviour and report validation problems under the public input name', async t => {
    assert.equal(myContext.behaviours.password.check('x'.repeat(11)), false);
    assert.equal(myContext.behaviours.password.check('x'.repeat(12)), true);
    assert.equal(myContext.behaviours.password.check('x'.repeat(128)), true);
    assert.equal(myContext.behaviours.password.check('x'.repeat(129)), false);
    const queries = [];
    const {request} = await start(t, async sql => { queries.push(sql); return {rows: [user]}; });
    for (const contrasena of ['short', 'x'.repeat(129), 123]) {
        const response = await request('/api/entities/usuarios', 'POST', {usuario: 'nuevo', contrasena});
        assert.equal(response.status, 400);
        const body = await response.json();
        assert.ok(body.problems.some(problem => problem.field === 'contrasena' && problem.details.type === 'password'));
    }
    assert.ok(queries.every(sql => !sql.startsWith('INSERT')));
});

test('anonymous access to all entity operations fails before touching the database', async t => {
    const {request} = await start(t, () => { throw new Error('Unexpected query'); });
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
        for (const path of ['/api/entities', '/api/entities/usuarios', '/api/entities/materias', '/api/entities/materias/delete-check', '/api/entities/materias/bulk-delete']) {
            const result = await request(path, method, method === 'GET' ? undefined : {}, '');
            assert.equal(result.status, 401);
            assert.equal(typeof (await result.json()).error, 'string');
        }
    }
});

test('JWT verification rejects tampering, wrong keys, algorithms, audience, issuer, expiration and missing claims', async t => {
    const {request, token} = await start(t, () => { throw new Error('JWT must be rejected before querying'); });
    const key = new TextEncoder().encode(secret);
    const claims = {sub: user.id, ver: user.version_sesion, iss: 'ssot2026', aud: 'ssot2026-api', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 900};
    const sign = (payload, signingKey = key, alg = 'HS256') => new SignJWT(payload).setProtectedHeader({alg, typ: 'JWT'}).sign(signingKey);
    const {exp: _exp, ...withoutExpiration} = claims;
    const invalid = [
        'bad', token.slice(0, -5) + 'xxxxx',
        Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url') + '.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.',
        await sign(claims, new TextEncoder().encode('another-test-only-key-of-at-least-32-bytes')),
        await sign(claims, new Uint8Array(64), 'HS512'),
        await sign({...claims, aud: 'another-app'}), await sign({...claims, iss: 'another-issuer'}),
        await sign({...claims, exp: claims.iat - 1}), await sign(withoutExpiration),
        await sign({...claims, sub: 7}), await sign({...claims, ver: 1}),
    ];
    for (const jwt of invalid) assert.equal((await request('/api/entities', 'GET', undefined, jwt)).status, 401);
});

test('login is public, normalizes usernames, returns a JWT and safe identity, and disables caching', async t => {
    const queries = [];
    const {request} = await start(t, async (sql, values) => {
        queries.push({sql, values});
        return {rows: [{...user, contrasena_hash: passwordHash}]};
    });
    const response = await request('/api/auth/login', 'POST', {usuario: 'ADMIN', contrasena: password}, '');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const result = await response.json();
    assert.equal(result.expiresIn, 86400);
    const claims = decodeJwt(result.token);
    assert.equal(claims.exp - claims.iat, 86400);
    assert.deepEqual(result.user, {id: user.id, usuario: user.usuario});
    assert.equal(result.token.split('.').length, 3);
    assert.ok(!JSON.stringify(result).includes(passwordHash));
    assert.deepEqual(queries[0].values, ['admin']);
    assert.equal((await request('/api/auth/me', 'GET', undefined, result.token)).status, 200);
});

test('session age is absolute: accepted near one day and rejected past it even with a later exp', async t => {
    const {request} = await start(t);
    const now = Math.floor(Date.now() / 1000);
    const token = age => new SignJWT({ver: user.version_sesion})
        .setProtectedHeader({alg: 'HS256', typ: 'JWT'}).setSubject(user.id)
        .setIssuer('ssot2026').setAudience('ssot2026-api').setIssuedAt(now - age)
        .setExpirationTime(now + 3600).sign(new TextEncoder().encode(secret));
    assert.equal((await request('/api/auth/me', 'GET', undefined, await token(86340))).status, 200);
    assert.equal((await request('/api/auth/me', 'GET', undefined, await token(86401))).status, 401);
});

test('bad credentials and missing users return the same error without disclosing secrets', async t => {
    for (const rows of [[], [{...user, contrasena_hash: passwordHash}]]) {
        const {request} = await start(t, async () => ({rows}));
        const response = await request('/api/auth/login', 'POST', {usuario: 'admin', contrasena: 'incorrect-long-password'}, '');
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), {error: 'Usuario o contraseña incorrectos.'});
    }
});

test('revoked and deleted accounts cannot use an otherwise valid JWT', async t => {
    for (const rows of [[], [{...user, version_sesion: 'new-version'}]]) {
        const {request} = await start(t, async () => ({rows}));
        assert.equal((await request('/api/entities')).status, 401);
    }
});

test('every authenticated account discovers and administers users through ordinary CRUD, including itself', async t => {
    const {request} = await start(t);
    const discovery = await request('/api/entities');
    assert.equal(discovery.status, 200);
    assert.ok((await discovery.json()).some(entity => entity.name === 'usuarios'));
    assert.equal((await request('/api/entities/usuarios')).status, 200);
    assert.equal((await request('/api/entities/usuarios', 'POST', {usuario: 'another', contrasena: password})).status, 204);
    assert.equal((await request('/api/entities/usuarios', 'PUT', {key: {id: user.id}, row: {usuario: 'renamed'}, version: '1'})).status, 204);
    assert.equal((await request('/api/entities/usuarios', 'DELETE', {id: user.id})).status, 204);
});

test('column security excludes secrets from SELECT, response metadata and rows, including unexpected extra database fields', async t => {
    let selection;
    const {request} = await start(t, async sql => {
        if (sql.includes('WHERE id = $1')) return {rows: [user]};
        selection = sql;
        return entityResult([{...user, contrasena_hash: 'private-hash', recuperacion_hashes: 'private-codes'}]);
    });
    const response = await request('/api/entities/usuarios');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.rows, [{id: user.id, usuario: user.usuario}]);
    assert.deepEqual(body.columns.map(c => c.name), ['usuario']);
    assert.deepEqual(body.pk, ['id']);
    assert.deepEqual(body.inputs.map(c => c.name), ['usuario', 'contrasena']);
    assert.equal(body.inputs[1].type, 'password');
    assert.deepEqual(body.inputs[1].constraints, {minLength: 12, maxLength: 128});
    assert.equal(body.inputs[1].optionalOnUpdate, true);
    assert.doesNotMatch(selection, /contrasena|recuperacion|version_sesion|SELECT \*/);
    assert.doesNotMatch(JSON.stringify(body), /private-|contrasena_hash|recuperacion|version_sesion/);
});

test('column security rejects writes to generated ids, password hashes, recovery hashes and session versions', async t => {
    const {request} = await start(t);
    const row = {usuario: 'nuevo', contrasena: password};
    for (const field of ['id', 'contrasena_hash', 'recuperacion_hashes', 'version_sesion']) {
        assert.equal((await request('/api/entities/usuarios', 'POST', {...row, [field]: 'attacker-value'})).status, 400);
        assert.equal((await request('/api/entities/usuarios', 'PUT', {key: {id: 'other'}, row: {...row, [field]: 'attacker-value'}, version: '1'})).status, 400);
    }
});

test('generic CRUD creates users with server-generated ids, hashed passwords and no recoverable plaintext', async t => {
    const queries = [];
    const {request} = await start(t, async (sql, values) => {
        queries.push({sql, values});
        return {rows: [user], rowCount: 1};
    });
    const response = await request('/api/entities/usuarios', 'POST', {usuario: 'NUEVO', contrasena: password});
    assert.equal(response.status, 204);
    const inserted = queries.find(q => q.sql.startsWith('INSERT'));
    const names = inserted.sql.match(/\(([^)]+)\)/)[1].split(', ').map(name => name.replaceAll('"', ''));
    const row = Object.fromEntries(names.map((name, i) => [name, inserted.values[i]]));
    assert.equal(row.usuario, 'nuevo');
    assert.equal(await verifyPassword(password, row.contrasena_hash), true);
    assert.ok(!inserted.values.includes(password));
    assert.equal(row.recuperacion_hashes, '[]');
    assert.equal(typeof row.id, 'string');
    assert.ok(!queries.some(q => /FOR UPDATE|BEGIN|COMMIT/.test(q.sql)));
});

test('account roles and activation states are not part of the API', async t => {
    const {request} = await start(t);
    for (const field of ['administrador', 'activo']) {
        assert.equal((await request('/api/entities/usuarios', 'POST', {usuario: 'admin', contrasena: password, [field]: true})).status, 400);
        assert.equal((await request('/api/entities/usuarios', 'PUT', {key: {id: user.id}, row: {usuario: 'admin', [field]: true}})).status, 400);
    }
});

test('anonymous authentication operations limit repeated attempts', async t => {
    const {request} = await start(t, () => { throw new Error('Malformed input must not query'); });
    for (let index = 0; index < 20; index++) assert.equal((await request('/api/auth/login', 'POST', {}, '')).status, 400);
    const response = await request('/api/auth/recover', 'POST', {}, '');
    assert.equal(response.status, 429);
    assert.ok(Number(response.headers.get('retry-after')) > 0);
});

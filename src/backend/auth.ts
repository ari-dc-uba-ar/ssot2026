import express, {type Express, type RequestHandler, type Response} from 'express';
import type {Pool} from 'pg';
import {jwtVerify, SignJWT} from 'jose';
import {randomUUID} from 'node:crypto';
import {entitySql} from './entity-sql.js';
import {authenticationEntity} from './system.js';
import {ApiFailure, apiErrorHandler, readObject} from './api-errors.js';
import {createRecoveryCodes, hashPassword, hashRecoveryCode, readPassword, readUsername, verifyPassword} from './credentials.js';
import type {AuthenticatedUser, LoginResponse, RecoveryCodesResponse, StoredRow} from './api-contract.js';

const users = entitySql(authenticationEntity);
const column = users.column;
const session = users.select('id', 'usuario', 'version_sesion');
const credentials = users.select(...session.fields, 'contrasena_hash');
const passwordHash = users.select('contrasena_hash');
type UserSession = Pick<StoredRow<typeof authenticationEntity>, typeof session.fields[number]>;
const publicUser = ({id, usuario}: AuthenticatedUser): AuthenticatedUser => ({id, usuario});
export function principal(res: Response): AuthenticatedUser {
    const user = res.locals['user'] as AuthenticatedUser | undefined;
    if (!user) throw new ApiFailure(401, 'Iniciá sesión para continuar.');
    return user;
}

export function createAuthentication(pool: Pick<Pool, 'query'>, secret = process.env['JWT_SECRET'] ?? '') {
    if (Buffer.byteLength(secret) < 32) throw new Error('JWT_SECRET debe contener al menos 32 bytes aleatorios.');
    const key = new TextEncoder().encode(secret);
    const issuer = 'ssot2026', audience = 'ssot2026-api';
    const expiresIn = 24 * 60 * 60;
    async function issueToken(user: UserSession): Promise<LoginResponse> {
        const token = await new SignJWT({ver: user.version_sesion})
            .setProtectedHeader({alg: 'HS256', typ: 'JWT'}).setSubject(user.id)
            .setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime(`${expiresIn}s`).sign(key);
        return {token, expiresIn, user: publicUser(user)};
    }
    const requireUser: RequestHandler = async (req, res, next) => {
        const token = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(req.headers.authorization ?? '')?.[1];
        if (!token) throw new ApiFailure(401, 'Iniciá sesión para continuar.');
        let identity;
        try {
            const {payload} = await jwtVerify(token, key, {
                algorithms: ['HS256'], typ: 'JWT', issuer, audience, maxTokenAge: expiresIn, requiredClaims: ['sub', 'iat', 'exp', 'ver'],
            });
            if (typeof payload.sub !== 'string' || typeof payload['ver'] !== 'string') throw new Error('Invalid claims');
            identity = {id: payload.sub, version: payload['ver']};
            res.locals['expiresAt'] = payload.exp! * 1000;
        } catch {
            throw new ApiFailure(401, 'La sesión venció o no es válida.');
        }
        const {rows} = await session.query(pool, `WHERE ${column('id')} = $1`, [identity.id]);
        const user = rows[0];
        if (!user || user.version_sesion !== identity.version) throw new ApiFailure(401, 'La sesión venció o no es válida.');
        res.locals['user'] = publicUser(user);
        res.setHeader('Cache-Control', 'no-store');
        next();
    };
    return {issueToken, requireUser};
}
export type Authentication = ReturnType<typeof createAuthentication>;

// Per-process limit; Express uses the socket IP unless a trusted proxy is explicitly configured.
function authenticationLimit(): RequestHandler {
    const attempts = new Map<string, {count: number; until: number}>();
    return (req, res, next) => {
        const now = Date.now();
        for (const [ip, entry] of attempts) if (entry.until <= now) attempts.delete(ip);
        const ip = req.ip ?? 'unknown';
        const entry = attempts.get(ip) ?? {count: 0, until: now + 15 * 60 * 1000};
        if (entry.count >= 20 || (!attempts.has(ip) && attempts.size >= 10000)) {
            res.setHeader('Retry-After', Math.ceil((entry.until - now) / 1000));
            throw new ApiFailure(429, 'Demasiados intentos. Volvé a intentar más tarde.');
        }
        entry.count++;
        attempts.set(ip, entry);
        next();
    };
}

export function registerAuthApi(app: Express, pool: Pick<Pool, 'query'>, auth: Authentication): void {
    const router = express.Router();
    router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
    router.use(express.json({limit: '8kb'}));
    const limit = authenticationLimit();
    router.post('/login', limit, async (req, res) => {
        const body = readObject(req.body, ['usuario', 'contrasena']);
        const invalidCredentials = 'No existe usuario con esas credenciales.';
        let usuario: string, password: string;
        try {
            usuario = readUsername(body['usuario']);
            password = readPassword(body['contrasena']);
        } catch (error) {
            if (!(error instanceof ApiFailure)) throw error;
            throw new ApiFailure(401, invalidCredentials);
        }
        const {rows} = await credentials.query(pool, `WHERE ${column('usuario')} = $1`, [usuario]);
        const user = rows[0];
        const verified = await verifyPassword(password, user?.contrasena_hash);
        if (!verified || !user) throw new ApiFailure(401, invalidCredentials);
        res.json(await auth.issueToken(user));
    });
    router.post('/recover', limit, async (req, res) => {
        const body = readObject(req.body, ['usuario', 'codigo', 'contrasena']);
        const usuario = readUsername(body['usuario']);
        if (typeof body['codigo'] !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{8}){3}$/.test(body['codigo'])) {
            throw new ApiFailure(400, 'El código de recuperación no es válido.');
        }
        const password = await hashPassword(readPassword(body['contrasena']));
        const recovery = createRecoveryCodes();
        // One atomic update consumes the previous set and revokes every existing JWT.
        const result = await pool.query(`UPDATE ${users.table} SET ${column('contrasena_hash')} = $1, ${column('recuperacion_hashes')} = $2, ${column('version_sesion')} = $3
            WHERE ${column('usuario')} = $4 AND ${column('recuperacion_hashes')}::jsonb ? $5 RETURNING ${column('id')}`,
        [password, recovery.hashes, randomUUID(), usuario, hashRecoveryCode(body['codigo'])]);
        if (!result.rowCount) throw new ApiFailure(401, 'Usuario o código de recuperación incorrectos.');
        res.json({codes: recovery.codes} satisfies RecoveryCodesResponse);
    });
    router.get('/me', auth.requireUser, (_req, res) => { res.json(principal(res)); });
    router.post('/logout', auth.requireUser, async (_req, res) => {
        await pool.query(`UPDATE ${users.table} SET ${column('version_sesion')} = $1 WHERE ${column('id')} = $2`, [randomUUID(), principal(res).id]);
        res.sendStatus(204);
    });
    router.post('/password', auth.requireUser, limit, async (req, res) => {
        const body = readObject(req.body, ['contrasenaActual', 'contrasena']);
        const currentPassword = readPassword(body['contrasenaActual']);
        const password = readPassword(body['contrasena']);
        const id = principal(res).id;
        const {rows} = await passwordHash.query(pool, `WHERE ${column('id')} = $1`, [id]);
        const previous = rows[0]?.contrasena_hash;
        if (!await verifyPassword(currentPassword, previous) || !previous) throw new ApiFailure(401, 'Contraseña actual incorrecta.');
        const recovery = createRecoveryCodes();
        const result = await pool.query(`UPDATE ${users.table} SET ${column('contrasena_hash')} = $1, ${column('recuperacion_hashes')} = $2, ${column('version_sesion')} = $3
            WHERE ${column('id')} = $4 AND ${column('contrasena_hash')} = $5`, [await hashPassword(password), recovery.hashes, randomUUID(), id, previous]);
        if (!result.rowCount) throw new ApiFailure(409, 'La cuenta cambió. Volvé a iniciar sesión.');
        res.json({codes: recovery.codes} satisfies RecoveryCodesResponse);
    });
    router.post('/recovery-codes', auth.requireUser, limit, async (req, res) => {
        const body = readObject(req.body, ['contrasena']);
        const password = readPassword(body['contrasena']);
        const id = principal(res).id;
        const {rows} = await passwordHash.query(pool, `WHERE ${column('id')} = $1`, [id]);
        const previous = rows[0]?.contrasena_hash;
        if (!await verifyPassword(password, previous) || !previous) throw new ApiFailure(401, 'Contraseña actual incorrecta.');
        const recovery = createRecoveryCodes();
        const result = await pool.query(`UPDATE ${users.table} SET ${column('recuperacion_hashes')} = $1 WHERE ${column('id')} = $2 AND ${column('contrasena_hash')} = $3`, [recovery.hashes, id, previous]);
        if (!result.rowCount) throw new ApiFailure(409, 'La cuenta cambió. Volvé a iniciar sesión.');
        res.json({codes: recovery.codes} satisfies RecoveryCodesResponse);
    });
    router.use((_req, res) => { res.status(404).json({error: 'Operación desconocida.'}); });
    router.use(apiErrorHandler);
    app.use('/api/auth', router);
}

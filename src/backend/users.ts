import {randomUUID} from 'node:crypto';
import type {Pool, PoolClient} from 'pg';
import type {AuthenticatedUser} from './api-contract.js';
import {ApiFailure} from './api-errors.js';
import {usersTable} from './auth.js';
import {hashPassword, readPassword, readUsername} from './credentials.js';

export async function administerUser(pool: Pool, actor: AuthenticatedUser, operation: (client: PoolClient) => Promise<void>): Promise<void> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Keep the acting admin active until commit. Concurrent cross-demotions cannot remove all admins.
        const result = await client.query(`SELECT id FROM ${usersTable} WHERE id = $1 AND activo = TRUE AND administrador = TRUE FOR UPDATE`, [actor.id]);
        if (!result.rowCount) throw new ApiFailure(403, 'Se requieren permisos de administrador.');
        await operation(client);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

export async function insertUser(db: Pick<Pool, 'query'>, row: Record<string, unknown>, password: unknown, recoveryHashes = '[]'): Promise<void> {
    const usuario = readUsername(row['usuario']);
    const hash = await hashPassword(readPassword(password));
    await db.query(`INSERT INTO ${usersTable} (id, usuario, administrador, activo, contrasena_hash, recuperacion_hashes, version_sesion)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`, [randomUUID(), usuario, row['administrador'], row['activo'], hash, recoveryHashes, randomUUID()]);
}

export async function updateUser(db: Pick<Pool, 'query'>, actor: AuthenticatedUser, id: string, row: Record<string, unknown>, password: unknown): Promise<void> {
    if (id === actor.id && (!row['activo'] || !row['administrador'])) {
        throw new ApiFailure(409, 'No podés desactivar ni quitar permisos a tu propia cuenta.');
    }
    const usuario = readUsername(row['usuario']);
    const hash = password === undefined ? undefined : await hashPassword(readPassword(password));
    const result = await db.query(`UPDATE ${usersTable} SET usuario = $1, administrador = $2, activo = $3${hash === undefined ? '' : ', contrasena_hash = $5, recuperacion_hashes = $6'}, version_sesion = $4 WHERE id = $${hash === undefined ? 5 : 7}`,
        [usuario, row['administrador'], row['activo'], randomUUID(), ...(hash === undefined ? [] : [hash, '[]']), id]);
    if (!result.rowCount) throw new ApiFailure(404, 'El registro ya no existe.');
}

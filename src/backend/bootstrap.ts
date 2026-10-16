import type {Pool} from 'pg';
import {completeEntity} from 'system-definition';
import {authenticationEntity, myContext, myEntities} from './system.js';
import {entityTable, insertPreparedRow, prepareEntityWrite} from './entity-write.js';
import {createRecoveryCodes} from './credentials.js';

export type BootstrapResult = {created: false} | {created: true; usuario: string; codes: string[]};
type BootstrapCredentials = {username: string | undefined; password: string | undefined};

export async function initializeUsers(pool: Pool, credentials: BootstrapCredentials = {
    username: process.env['AUTH_ADMIN_USERNAME'], password: process.env['AUTH_ADMIN_PASSWORD'],
}): Promise<BootstrapResult> {
    const entity = completeEntity(myContext, myEntities[authenticationEntity]);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${entityTable(entity.name)}:bootstrap`]);
        const existing = await client.query(`SELECT id FROM ${entityTable(entity.name)} LIMIT 1`);
        if (existing.rows.length) {
            await client.query('COMMIT');
            return {created: false};
        }
        if (!credentials.username || !credentials.password) {
            throw new Error('Configurá AUTH_ADMIN_USERNAME y AUTH_ADMIN_PASSWORD para inicializar la tabla de usuarios vacía.');
        }
        const row = await prepareEntityWrite(entity, {usuario: credentials.username, contrasena: credentials.password}, 'create');
        const recovery = createRecoveryCodes();
        row['recuperacion_hashes'] = recovery.hashes;
        await insertPreparedRow(client, entity, row);
        await client.query('COMMIT');
        return {created: true, usuario: String(row['usuario']), codes: recovery.codes};
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

export function reportInitialization(result: BootstrapResult): void {
    if (result.created) console.log(`Usuario inicial creado: ${result.usuario}. Guardá estos códigos de recuperación; no se mostrarán de nuevo:\n${result.codes.join('\n')}`);
}

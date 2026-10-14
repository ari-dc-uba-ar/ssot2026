import express, {type Express} from 'express';
import type {Pool} from 'pg';
import {completeEntity, instanceProblems, validateInstance, type EntityInfo} from 'system-definition';
import {quotePgIdentifier as quote} from '@system-definition/postgres-migrations';
import {myContext, myEntities, authenticationEntity} from './system.js';
import {databaseSettings} from './database.js';
import type {ApiError, EntityNamesResponse, EntityResponse} from './api-contract.js';
import {ApiFailure, apiErrorHandler, readObject} from './api-errors.js';
import {type Authentication, principal, requireAdministrator} from './auth.js';
import {allowedFields} from './column-security.js';
import {administerUser, insertUser, updateUser} from './users.js';

function readRow(fields: EntityInfo<typeof myContext>['fields'], value: unknown): Record<string, unknown> {
    const row = readObject(value, Object.keys(fields));
    const problems = instanceProblems(myContext, fields, row);
    if (problems.length) throw new ApiFailure(400, problems.map(p => `${p.field}: ${p.messageKey}`).join('; '), problems);
    return row;
}

export function registerEntityApi(app: Express, pool: Pool, auth: Authentication): void {
    const router = express.Router();
    router.use(auth.requireUser);
    router.use(express.json({limit: '64kb'}));
    router.get('/', (_req, res) => {
        res.json(Object.values(myEntities).filter(entity => entity.name !== authenticationEntity || principal(res).administrador)
            .map(entity => entity.name) satisfies EntityNamesResponse);
    });
    for (const definition of Object.values(myEntities)) {
        const entity: EntityInfo<typeof myContext> = completeEntity(myContext, definition);
        const isUsers = entity.name === authenticationEntity;
        const readable = allowedFields(entity, 'read');
        const writable = allowedFields(entity, 'write');
        const readNames = Object.keys(readable), writeNames = Object.keys(writable);
        const fields = readNames.map(quote).join(', ');
        const writeFields = writeNames.map(quote).join(', ');
        const table = `${quote(databaseSettings.database.schema)}.${quote(entity.name)}`;
        const keys = Object.fromEntries(entity.pk.map(name => [name, entity.fields[name]!]));
        const columns = Object.values(readable).map(({name, label, type, nullable, writable}) => ({name, label, type, nullable, writable}));
        const values = (row: Record<string, unknown>) => writeNames.map(name => row[name]);
        const keyValues = (key: unknown) => {
            const row = readRow(keys, key);
            return entity.pk.map(name => row[name]);
        };
        const where = (offset = 0) => entity.pk.map((name, i) => `${quote(name)} = $${offset + i + 1}`).join(' AND ');
        const validatedRow = (body: unknown, create: boolean) => {
            const input = readObject(body, [...writeNames, ...(isUsers && create ? ['contrasena'] : [])], isUsers && !create ? ['contrasena'] : []);
            const row = readRow(writable, Object.fromEntries(writeNames.map(name => [name, input[name]])));
            const problems = validateInstance(myContext.validators, entity.validators, row);
            if (problems.length) throw new ApiFailure(400, problems.map(p => p.messageKey).join('; '), problems);
            return {row, password: input['contrasena']};
        };
        if (isUsers) router.use(`/${entity.name}`, requireAdministrator);
        router.route(`/${entity.name}`)
            .get(async (_req, res) => {
                const result = await pool.query<Record<string, unknown>>(`SELECT ${fields} FROM ${table} ORDER BY ${entity.pk.map(quote).join(', ')}`);
                const rows = result.rows.map(row => {
                    const projected = Object.fromEntries(readNames.map(name => [name, row[name]]));
                    if (readNames.some(name => !Object.hasOwn(row, name)) || instanceProblems(myContext, readable, projected).length) {
                        throw new Error(`Database row does not match the SSOT for ${entity.name}`);
                    }
                    return projected;
                });
                res.json({name: entity.name, pk: entity.pk, columns, rows} as EntityResponse);
            })
            .post(async (req, res) => {
                const {row, password} = validatedRow(req.body, true);
                if (isUsers) await administerUser(pool, principal(res), client => insertUser(client, row, password));
                else await pool.query(`INSERT INTO ${table} (${writeFields}) VALUES (${writeNames.map((_, i) => `$${i + 1}`).join(', ')})`, values(row));
                res.sendStatus(204);
            })
            .put(async (req, res) => {
                const body = readObject(req.body, ['key', 'row']);
                const {row, password} = validatedRow(body['row'], false);
                const key = keyValues(body['key']);
                if (isUsers) await administerUser(pool, principal(res), client => updateUser(client, principal(res), key[0] as string, row, password));
                else {
                    const result = await pool.query(`UPDATE ${table} SET ${writeNames.map((name, i) => `${quote(name)} = $${i + 1}`).join(', ')} WHERE ${where(writeNames.length)}`, [...values(row), ...key]);
                    if (result.rowCount === 0) throw new ApiFailure(404, 'El registro ya no existe.');
                }
                res.sendStatus(204);
            })
            .delete(async (req, res) => {
                const key = keyValues(req.body);
                if (isUsers) {
                    if (key[0] === principal(res).id) throw new ApiFailure(409, 'No podés eliminar tu propia cuenta.');
                    await administerUser(pool, principal(res), async client => {
                        const result = await client.query(`DELETE FROM ${table} WHERE ${where()}`, key);
                        if (!result.rowCount) throw new ApiFailure(404, 'El registro ya no existe.');
                    });
                } else {
                    const result = await pool.query(`DELETE FROM ${table} WHERE ${where()}`, key);
                    if (!result.rowCount) throw new ApiFailure(404, 'El registro ya no existe.');
                }
                res.sendStatus(204);
            });
    }
    router.use((_req, res) => { res.status(404).json({error: 'Entidad desconocida'} satisfies ApiError); });
    router.use(apiErrorHandler);
    app.use('/api/entities', router);
}

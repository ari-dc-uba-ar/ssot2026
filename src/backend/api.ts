import express, {type Express} from 'express';
import type {Pool} from 'pg';
import {completeEntity, instanceProblems, type EntityInfo} from 'system-definition';
import {quotePgIdentifier as quote} from '@system-definition/postgres-migrations';
import {myContext, myEntities} from './system.js';
import type {ApiError, EntityForeignKey, EntityNamesResponse, EntityResponse} from './api-contract.js';
import {ApiFailure, apiErrorHandler, readObject} from './api-errors.js';
import type {Authentication} from './auth.js';
import {allowedFields} from './column-security.js';
import {entityTable, insertPreparedRow, prepareEntityWrite} from './entity-write.js';

function readRow(fields: EntityInfo<typeof myContext>['fields'], value: unknown): Record<string, unknown> {
    const row = readObject(value, Object.keys(fields));
    const problems = instanceProblems(myContext, fields, row);
    if (problems.length) throw new ApiFailure(400, problems.map(p => `${p.field}: ${p.messageKey}`).join('; '), problems);
    return row;
}

export function registerEntityApi(app: Express, pool: Pick<Pool, 'query'>, auth: Authentication): void {
    const router = express.Router();
    router.use(auth.requireUser);
    router.use(express.json({limit: '64kb'}));
    router.get('/', (_req, res) => {
        res.json(Object.values(myEntities).map(entity => entity.name) satisfies EntityNamesResponse);
    });
    for (const definition of Object.values(myEntities)) {
        const entity: EntityInfo<typeof myContext> = completeEntity(myContext, definition);
        const readable = allowedFields(entity, 'read');
        const writable = allowedFields(entity, 'write');
        const readNames = Object.keys(readable);
        const fields = readNames.map(quote).join(', ');
        const table = entityTable(entity.name);
        const keys = Object.fromEntries(entity.pk.map(name => [name, entity.fields[name]!]));
        const columns = Object.values(readable).map(({name, label, type, nullable, writable}) => ({name, label, type, nullable, writable}));
        const inputs = Object.values(writable).map(({inputName: name, inputType: type, inputConstraints: constraints, label, nullable, transform}) => ({
            name, label, type, nullable, constraints, optionalOnUpdate: transform === 'password',
        }));
        const foreignKeys = Object.entries(entity.fks).flatMap(([name, fk]) => {
            const target = completeEntity(myContext, myEntities[fk.entity as keyof typeof myEntities]);
            const targetReadable = allowedFields(target, 'read');
            const pairs = Object.entries(fk.fields);
            if (!pairs.every(([source, destination]) => writable[source] && targetReadable[destination])) return [];
            return [{name, entity: target.name,
                fields: Object.fromEntries(pairs.map(([source, destination]) => [writable[source]!.inputName, destination])),
                displayFields: [...new Set([...pairs.map(([, destination]) => destination),
                    ...Object.values(targetReadable).filter(field => field.isName).map(field => field.name)])],
            } as EntityForeignKey];
        });
        const keyValues = (key: unknown) => {
            const row = readRow(keys, key);
            return entity.pk.map(name => row[name]);
        };
        const where = (offset = 0) => entity.pk.map((name, i) => `${quote(name)} = $${offset + i + 1}`).join(' AND ');
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
                res.json({name: entity.name, pk: entity.pk, columns, inputs, foreignKeys, rows} as EntityResponse);
            })
            .post(async (req, res) => {
                const row = await prepareEntityWrite(entity, req.body, 'create');
                await insertPreparedRow(pool, entity, row);
                res.sendStatus(204);
            })
            .put(async (req, res) => {
                const body = readObject(req.body, ['key', 'row']);
                const key = keyValues(body['key']);
                const row = await prepareEntityWrite(entity, body['row'], 'update');
                const names = Object.keys(row);
                const result = await pool.query(`UPDATE ${table} SET ${names.map((name, i) => `${quote(name)} = $${i + 1}`).join(', ')} WHERE ${where(names.length)}`, [...names.map(name => row[name]), ...key]);
                if (!result.rowCount) throw new ApiFailure(404, 'El registro ya no existe.');
                res.sendStatus(204);
            })
            .delete(async (req, res) => {
                const key = keyValues(req.body);
                const result = await pool.query(`DELETE FROM ${table} WHERE ${where()}`, key);
                if (!result.rowCount) throw new ApiFailure(404, 'El registro ya no existe.');
                res.sendStatus(204);
            });
    }
    router.use((_req, res) => { res.status(404).json({error: 'Entidad desconocida'} satisfies ApiError); });
    router.use(apiErrorHandler);
    app.use('/api/entities', router);
}

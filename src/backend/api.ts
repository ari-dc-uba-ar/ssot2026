import express, {type Express, type Request, type Response, type NextFunction} from 'express';
import type {Pool} from 'pg';
import {completeEntity, instanceProblems, isPlainObject, validateInstance, type EntityInfo} from 'system-definition';
import {quotePgIdentifier as quote} from '@system-definition/postgres-migrations';
import {myContext, myEntities} from './system.js';
import {databaseSettings} from './database.js';
import type {ApiError, EntityNamesResponse, EntityResponse} from './api-contract.js';

class ApiFailure extends Error {
    readonly status: number;
    constructor(status: number, message: string) { super(message); this.status = status; }
}

function readRow(fields: EntityInfo<typeof myContext>['fields'], value: unknown): Record<string, unknown> {
    const names = Object.keys(fields);
    if (!isPlainObject(value) || Object.keys(value).length !== names.length || names.some(name => !Object.hasOwn(value, name))) {
        throw new ApiFailure(400, 'Se deben enviar exactamente los campos indicados por la API.');
    }
    const problems = instanceProblems(myContext, fields, value);
    if (problems.length) {
        throw new ApiFailure(400, problems.map(p => `${p.field}: ${p.messageKey}`).join('; '));
    }
    return value;
}

export function registerEntityApi(app: Express, pool: Pool): void {
    app.use('/api/entities', express.json({limit: '64kb'}));
    app.get('/api/entities', (_, res) => {
        res.json(Object.values(myEntities).map(entity => entity.name) satisfies EntityNamesResponse);
    });
    for (const definition of Object.values(myEntities)) {
        const entity: EntityInfo<typeof myContext> = completeEntity(myContext, definition);
        const names = Object.keys(entity.fields);
        const fields = names.map(quote).join(', ');
        const table = `${quote(databaseSettings.database.schema)}.${quote(entity.name)}`;
        const keys = Object.fromEntries(entity.pk.map(name => [name, entity.fields[name]!]));
        const columns = Object.values(entity.fields).map(({name, label, type, nullable}) => ({name, label, type, nullable}));
        const values = (row: Record<string, unknown>) => names.map(name => row[name]);
        const keyValues = (key: unknown) => {
            const row = readRow(keys, key);
            return entity.pk.map(name => row[name]);
        };
        const where = (offset = 0) => entity.pk.map((name, i) => `${quote(name)} = $${offset + i + 1}`).join(' AND ');
        const validatedRow = (body: unknown) => {
            const row = readRow(entity.fields, body);
            const problems = validateInstance(myContext.validators, entity.validators, row);
            if (problems.length) throw new ApiFailure(400, problems.map(p => p.messageKey).join('; '));
            return row;
        };
        app.route(`/api/entities/${entity.name}`)
            .get(async (_, res) => {
                const result = await pool.query<Record<string, unknown>>(`SELECT ${fields} FROM ${table} ORDER BY ${entity.pk.map(quote).join(', ')}`);
                const rows = result.rows.map(row => {
                    const projected = Object.fromEntries(names.map(name => [name, row[name]]));
                    if (names.some(name => !Object.hasOwn(row, name)) || instanceProblems(myContext, entity.fields, projected).length) {
                        throw new Error(`Database row does not match the SSOT for ${entity.name}`);
                    }
                    return projected;
                });
                // Reflection loses field literals; every returned value was checked against the SSOT.
                res.json({name: entity.name, pk: entity.pk, columns, rows} as EntityResponse);
            })
            .post(async (req, res) => {
                const row = validatedRow(req.body);
                await pool.query(`INSERT INTO ${table} (${fields}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')})`, values(row));
                res.sendStatus(204);
            })
            .put(async (req, res) => {
                const body: unknown = req.body;
                if (!isPlainObject(body) || Object.keys(body).length !== 2 || !Object.hasOwn(body, 'key') || !Object.hasOwn(body, 'row')) {
                    throw new ApiFailure(400, 'Se requiere {key, row}.');
                }
                const row = validatedRow(body['row']);
                const result = await pool.query(`UPDATE ${table} SET ${names.map((name, i) => `${quote(name)} = $${i + 1}`).join(', ')} WHERE ${where(names.length)}`, [...values(row), ...keyValues(body['key'])]);
                if (result.rowCount === 0) throw new ApiFailure(404, 'El registro ya no existe.');
                res.sendStatus(204);
            })
            .delete(async (req, res) => {
                const result = await pool.query(`DELETE FROM ${table} WHERE ${where()}`, keyValues(req.body));
                if (result.rowCount === 0) throw new ApiFailure(404, 'El registro ya no existe.');
                res.sendStatus(204);
            });
    }
    app.use('/api/entities', (_, res) => {
        res.status(404).json({error: 'Entidad desconocida'} satisfies ApiError);
    });
    app.use('/api/entities', (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
        const conflicts: Record<string, string> = {
            '23505': 'Ya existe un registro con esa clave.',
            '23503': 'El registro tiene una referencia inválida o está siendo utilizado.',
            '23502': 'Falta un campo obligatorio.',
            '23514': 'Los datos no cumplen una restricción.',
            '22003': 'Un número está fuera del rango permitido.',
        };
        const code = error instanceof Error && 'code' in error ? String(error.code) : '';
        const conflict = conflicts[code];
        const malformed = error instanceof SyntaxError && 'body' in error;
        const status = error instanceof ApiFailure ? error.status : conflict ? 409 : malformed ? 400 : 500;
        const message = error instanceof ApiFailure ? error.message : conflict ?? (malformed ? 'JSON inválido.' : 'No se pudieron procesar los datos.');
        if (status === 500) console.error('Entity API query failed:', error);
        res.status(status).json({error: message} satisfies ApiError);
    });
}

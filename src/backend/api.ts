import express, {type Express} from 'express';
import type {Pool} from 'pg';
import {completeEntity, instanceProblems, type EntityInfo} from 'system-definition';
import {quotePgIdentifier as quote} from '@system-definition/postgres-migrations';
import {myContext, myEntities, entityLabels} from './system.js';
import {browsing} from './browsing.js';
import {inputConstraints} from './value-types.js';
import {readQuery, queryEntity} from './entity-query.js';
import type {EntityName} from './api-contract.js';
import type {ApiError, DeleteDependencyBlocker, DeleteDependencyCheck, EntityForeignKey, EntityNamesResponse, EntityResponse} from './api-contract.js';
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

export function registerEntityApi(app: Express, pool: Pick<Pool, 'query' | 'connect'>, auth: Authentication,
    publish: (name: EntityName) => void = () => {}): void {
    const router = express.Router();
    const entities = new Map<EntityName, EntityInfo<typeof myContext>>(Object.values(myEntities)
        .map(definition => [definition.name, completeEntity(myContext, definition)]));
    router.use(auth.requireUser);
    router.use(express.json({limit: '64kb'}));
    router.get('/', (_req, res) => {
        res.json(Object.values(myEntities).map(({name}) => ({name, label: entityLabels[name]})) satisfies EntityNamesResponse);
    });
    for (const definition of Object.values(myEntities)) {
        const entity = entities.get(definition.name)!;
        const readable = allowedFields(entity, 'read');
        const writable = allowedFields(entity, 'write');
        const readNames = Object.keys(readable);
        const table = entityTable(entity.name);
        const keys = Object.fromEntries(entity.pk.map(name => [name, entity.fields[name]!]));
        const columns = Object.values(readable).filter(field => field.visible)
            .map(({name, label, type, nullable, writable}) => ({name, label, type, nullable, writable, constraints: inputConstraints[type]}));
        const inputs = Object.values(writable).map(({inputName: name, inputType: type, inputConstraints: constraints, label, nullable, transform}) => ({
            name, label, type, nullable, constraints, optionalOnUpdate: transform === 'password',
        }));
        const foreignKeys = Object.entries(entity.fks).flatMap(([name, fk]) => {
            const target = entities.get(fk.entity as EntityName)!;
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
        const readKeys = (value: unknown): unknown[][] => {
            const body = readObject(value, ['keys']);
            if (!Array.isArray(body['keys']) || body['keys'].length === 0 || body['keys'].length > browsing.bulkDeleteLimit) {
                throw new ApiFailure(400, `Seleccioná entre 1 y ${browsing.bulkDeleteLimit} filas para borrar.`);
            }
            const parsed = body['keys'].map(keyValues);
            if (new Set(parsed.map(key => JSON.stringify(key))).size !== parsed.length) {
                throw new ApiFailure(400, 'La selección contiene filas repetidas.');
            }
            return parsed;
        };
        const whereKeys = (rows: readonly unknown[][], alias = '') => rows.map((_, rowIndex) =>
            `(${entity.pk.map((name, columnIndex) =>
                `${alias}${quote(name)} = $${rowIndex * entity.pk.length + columnIndex + 1}`).join(' AND ')})`
        ).join(' OR ');
        const dependencyBlockers = async (
            rows: readonly unknown[][],
            executor: Pick<Pool, 'query'>,
        ): Promise<DeleteDependencyBlocker[]> => {
            const blockers: DeleteDependencyBlocker[] = [];
            for (const dependentDefinition of Object.values(myEntities)) {
                const dependent = entities.get(dependentDefinition.name)!;
                for (const [relationship, foreignKey] of Object.entries(dependent.fks)) {
                    if (foreignKey.entity !== entity.name) continue;
                    const pairs = Object.entries(foreignKey.fields);
                    const join = pairs.map(([source, target]) =>
                        `dependent.${quote(source)} = target.${quote(target)}`).join(' AND ');
                    const dependentKeys = dependent.pk.map(name => `dependent.${quote(name)}`).join(', ');
                    const keyOrder = dependent.pk.map(quote).join(', ');
                    const result = await executor.query<{count: number | string; keys: Record<string, unknown>[]}>(
                        `WITH matching AS (` +
                        `SELECT DISTINCT ${dependentKeys} FROM ${entityTable(dependent.name)} AS dependent ` +
                        `JOIN ${table} AS target ON ${join} WHERE ${whereKeys(rows, 'target.')}) ` +
                        `SELECT (SELECT count(*)::int FROM matching) AS count, ` +
                        `COALESCE((SELECT json_agg(to_jsonb(sample)) FROM (` +
                        `SELECT * FROM matching ORDER BY ${keyOrder} LIMIT 10) AS sample), '[]'::json) AS keys`,
                        rows.flat(),
                    );
                    const count = Number(result.rows[0]?.count ?? 0);
                    if (count > 0) {
                        const keys = result.rows[0]?.keys;
                        if (!keys) throw new Error(`Database did not return dependent keys for ${dependent.name}.${relationship}`);
                        blockers.push({
                            entity: dependentDefinition.name,
                            relationship,
                            count,
                            keys,
                        } as DeleteDependencyBlocker);
                    }
                }
            }
            return blockers;
        };
        const checkDependencies = async (req: express.Request, res: express.Response) => {
            const rows = readKeys(req.body);
            const blockers = await dependencyBlockers(rows, pool);
            res.json({blockers} satisfies DeleteDependencyCheck);
        };
        router.post(`/${entity.name}/delete-check`, checkDependencies);
        router.post(`/${entity.name}/bulk-delete`, async (req, res) => {
            const rows = readKeys(req.body);
            const client = await pool.connect();
            let transactionStarted = false;
            try {
                await client.query('BEGIN');
                transactionStarted = true;
                const selected = await client.query(
                    `SELECT ${entity.pk.map(quote).join(', ')} FROM ${table} WHERE ${whereKeys(rows)} ` +
                    `ORDER BY ${entity.pk.map(quote).join(', ')} FOR UPDATE`,
                    rows.flat(),
                );
                if (selected.rowCount !== rows.length) throw new ApiFailure(404, 'Una o más filas seleccionadas ya no existen.');
                const blockers = await dependencyBlockers(rows, client);
                if (blockers.length) {
                    const details = blockers.map(({entity: name, relationship, count}) =>
                        `${name} (${relationship}): ${count}`).join(', ');
                    throw new ApiFailure(409, `No se puede borrar la selección: hay filas dependientes en ${details}.`);
                }
                const deleted = await client.query(
                    `DELETE FROM ${table} WHERE ${whereKeys(rows)} RETURNING ${entity.pk.map(quote).join(', ')}`,
                    rows.flat(),
                );
                if (deleted.rowCount !== rows.length) throw new ApiFailure(404, 'Una o más filas seleccionadas ya no existen.');
                await client.query('COMMIT');
                transactionStarted = false;
                publish(definition.name);
                res.sendStatus(204);
            } catch (error) {
                if (transactionStarted) await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        });
        router.route(`/${entity.name}`)
            .get(async (req, res) => {
                const parameters = readObject(req.query, [], ['query']);
                let input: unknown = {};
                if (parameters['query'] !== undefined) {
                    if (typeof parameters['query'] !== 'string') throw new ApiFailure(400, 'Consulta inválida.');
                    try { input = JSON.parse(parameters['query']); } catch { throw new ApiFailure(400, 'Consulta inválida.'); }
                }
                const result = await queryEntity(pool, entity.name, readable, entity.pk, readQuery(input, readable));
                const rows = result.rows.map(row => {
                    const projected = Object.fromEntries(readNames.map(name => [name, row[name]]));
                    if (readNames.some(name => !Object.hasOwn(row, name)) || instanceProblems(myContext, readable, projected).length) {
                        throw new Error(`Database row does not match the SSOT for ${entity.name}`);
                    }
                    return projected;
                });
                res.json({name: entity.name, label: entityLabels[definition.name], browsing, pk: entity.pk, columns, inputs, foreignKeys,
                    ...result, rows} as EntityResponse);
            })
            .post(async (req, res) => {
                const row = await prepareEntityWrite(entity, req.body, 'create');
                await insertPreparedRow(pool, entity, row);
                publish(definition.name);
                res.sendStatus(204);
            })
            .put(async (req, res) => {
                const body = readObject(req.body, ['key', 'row', 'version']);
                if (typeof body['version'] !== 'string' || !/^\d+$/.test(body['version'])) throw new ApiFailure(400, 'Falta la versión del registro.');
                const key = keyValues(body['key']);
                const row = await prepareEntityWrite(entity, body['row'], 'update');
                const names = Object.keys(row);
                let result;
                try {
                    result = await pool.query(`UPDATE ${table} SET ${names.map((name, i) => `${quote(name)} = $${i + 1}`).join(', ')} WHERE ${where(names.length)} AND xmin::text = $${names.length + key.length + 1}`, [...names.map(name => row[name]), ...key, body['version']]);
                } catch (error) {
                    // PostgreSQL identifies the referencing table without exposing submitted values.
                    const dependent = error instanceof Error && 'table' in error
                        ? Object.values(myEntities).find(definition => definition.name === error.table) : undefined;
                    const changedKey = entity.pk.some((name, index) => Object.hasOwn(row, name) && row[name] !== key[index]);
                    if (error instanceof Error && 'code' in error && error.code === '23503' && changedKey &&
                        dependent && dependent.name !== entity.name &&
                        Object.values(entities.get(dependent.name)!.fks).some(fk => fk.entity === entity.name)) {
                        throw new ApiFailure(409, `No se puede cambiar la clave porque hay registros en ${entityLabels[dependent.name]} que utilizan esta fila. Tu borrador se conserva; podés corregir la clave o cancelar los cambios.`);
                    }
                    throw error;
                }
                if (!result.rowCount) throw new ApiFailure(409, 'Otra persona cambió o eliminó este registro. Tu borrador se conservó; revisá los datos actuales antes de volver a guardar.');
                publish(definition.name);
                res.sendStatus(204);
            })
            .delete(async (req, res) => {
                const key = keyValues(req.body);
                const result = await pool.query(`DELETE FROM ${table} WHERE ${where()}`, key);
                if (!result.rowCount) throw new ApiFailure(404, 'El registro ya no existe.');
                publish(definition.name);
                res.sendStatus(204);
            });
    }
    router.use((_req, res) => { res.status(404).json({error: 'Entidad desconocida'} satisfies ApiError); });
    router.use(apiErrorHandler);
    app.use('/api/entities', router);
}

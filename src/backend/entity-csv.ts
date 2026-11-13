import type {Pool} from 'pg';
import type {EntityInfo} from 'system-definition';
import {sql, identifier, entityTable, joinSql, querySql, equalSql} from './sql.js';
import {myContext} from './system.js';
import {ApiFailure} from './api-errors.js';
import {insertPreparedRow, prepareEntityWrite} from './entity-write.js';
import {parseCsv, stringifyCsv} from './csv.js';
import type {CsvImportResponse, EntityResponse, FieldValue} from './browser-contract.js';
import {allowedFields} from './column-security.js';
import {csvSettings} from './csv-settings.js';

type Entity = EntityInfo<typeof myContext>;
type CsvField = Entity['fields'][string];
type Database = Pick<Pool, 'query' | 'connect'>;

function csvFields(entity: Entity): CsvField[] {
    return Object.values(allowedFields(entity, 'read')).filter(field => field.visible);
}

// A CSV is importable only when its public fields can reconstruct a complete write and key.
export function csvCapabilities(entity: Entity): EntityResponse['csv'] {
    const fields = csvFields(entity);
    const writable = Object.values(allowedFields(entity, 'write'));
    return {
        export: fields.length > 0,
        import: fields.length > 0 && fields.every(field => field.writable && field.inputType === field.type && field.transform === null && field.onCreate === null) &&
            writable.every(field => fields.includes(field)) && entity.pk.every(name => fields.some(field => field.name === name)),
        maxBytes: csvSettings.maxBytes,
    };
}

export async function exportEntityCsv(pool: Pick<Pool, 'query'>, entity: Entity): Promise<string> {
    const fields = csvFields(entity);
    if (!csvCapabilities(entity).export) throw new ApiFailure(403, 'Esta entidad no permite exportar CSV.');
    const result = await querySql<Record<string, FieldValue>>(pool,
        sql`SELECT ${joinSql(fields.map(field => identifier(field.name)))} FROM ${entityTable(entity.name)} ORDER BY ${joinSql(entity.pk.map(name => identifier(name)))}`,
    );
    const rows: FieldValue[][] = [fields.map(field => field.label),
        ...result.rows.map(row => fields.map(field => row[field.name]!))];
    return stringifyCsv(rows);
}

export async function importEntityCsv(pool: Database, entity: Entity, text: unknown): Promise<CsvImportResponse> {
    if (!csvCapabilities(entity).import) throw new ApiFailure(403, 'Esta entidad no permite importar CSV.');
    if (typeof text !== 'string') throw new ApiFailure(400, 'Se requiere un archivo CSV.');

    const fields = csvFields(entity);
    const headers = fields.map(field => field.label);

    let records: (string | null)[][];
    try {
        records = parseCsv(text);
    } catch {
        throw new ApiFailure(400, 'Error de formato en el CSV.');
    }
    if (!records.length || records[0]!.length !== headers.length ||
        records[0]!.some((header, index) => header !== headers[index])) {
        const index = headers.findIndex((header, column) => records[0]?.[column] !== header);
        const expected = headers[index];
        throw new ApiFailure(400, expected
            ? `El encabezado de la columna «${expected}» no coincide con la entidad.`
            : 'Los encabezados del CSV no coinciden con la entidad.');
    }

    const inputRows = records.slice(1).map(record => {
        const row: Record<string, unknown> = {};
        for (let index = 0; index < headers.length; index++) {
            const field = fields[index]!;
            const text = record[index]!;
            if (text === null) {
                row[field.inputName] = null;
                continue;
            }
            const value = myContext.behaviours[field.inputType].deserialize(text);
            if (!value.ok) throw new ApiFailure(400, `Valor inválido en la columna «${field.label}».`);
            row[field.inputName] = value.value;
        }
        return row;
    });

    const preparedRows: Record<string, unknown>[] = [];
    const seen = new Map<string, Record<string, unknown>>();
    const conflicts: string[] = [];
    let conflictCount = 0;
    const reportConflict = (row: Record<string, unknown>) => {
        conflictCount++;
        if (conflicts.length < 50) {
            conflicts.push(`{${entity.pk.map(name => `«${entity.fields[name]!.label}»=${JSON.stringify(row[name])}`).join(', ')}}`);
        }
    };
    const equalCsvValues = (left: Record<string, unknown>, right: Record<string, unknown>) =>
        fields.every(field => Object.is(left[field.name], right[field.name]));

    for (const input of inputRows) {
        let prepared: Record<string, unknown>;
        try {
            prepared = await prepareEntityWrite(entity, input, 'create');
        } catch (error) {
            if (!(error instanceof ApiFailure)) throw error;
            const invalidFields = [...new Set(error.problems
                .map(problem => problem.field && (entity.fields[problem.field]?.label ??
                    Object.values(entity.fields).find(field => field.inputName === problem.field)?.label))
                .filter((label): label is string => !!label))];
            if (invalidFields.length) {
                throw new ApiFailure(error.status, `Datos inválidos en la columna${invalidFields.length === 1 ? '' : 's'} ${invalidFields.map(label => `«${label}»`).join(', ')}.`);
            }
            throw error;
        }
        const key = JSON.stringify(entity.pk.map(name => prepared[name]));
        const previous = seen.get(key);
        if (previous) {
            if (!equalCsvValues(previous, prepared)) reportConflict(prepared);
            continue;
        }
        seen.set(key, prepared);
        preparedRows.push(prepared);
    }
    if (conflictCount) throw duplicateConflict('El CSV contiene claves duplicadas con datos distintos', conflicts, conflictCount);

    const client = await pool.connect();
    let transactionStarted = false;
    let inserted = 0;
    try {
        await client.query('BEGIN');
        transactionStarted = true;
        for (const row of preparedRows) {
            await validateForeignKeys(client, entity, row);
            const keyValues = entity.pk.map(name => row[name]);
            const statement = sql`SELECT ${joinSql(fields.map(field => identifier(field.name)))} FROM ${entityTable(entity.name)} WHERE ${equalSql(entity.pk, keyValues)} FOR UPDATE`;
            const existing = await querySql<Record<string, unknown>>(client, statement);
            if (existing.rows.length) {
                if (!equalCsvValues(existing.rows[0]!, row)) reportConflict(row);
                continue;
            }
            if (await insertPreparedRow(client, entity, row, 'ignore')) {
                inserted++;
                continue;
            }
            const raced = await querySql<Record<string, unknown>>(client, statement);
            if (!raced.rows.length || !equalCsvValues(raced.rows[0]!, row)) reportConflict(row);
        }
        if (conflictCount) {
            throw duplicateConflict('El CSV entra en conflicto con datos existentes', conflicts, conflictCount);
        }
        await client.query('COMMIT');
        transactionStarted = false;
    } catch (error) {
        if (transactionStarted) await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
    return {inserted, unchanged: inputRows.length - inserted};
}

function duplicateConflict(message: string, conflicts: readonly string[], count: number): ApiFailure {
    const additional = count - conflicts.length;
    return new ApiFailure(409, `${message}: ${conflicts.join(', ')}${additional ? ` y ${additional} más` : ''}.`);
}

async function validateForeignKeys(client: Pick<Pool, 'query'>, entity: Entity, row: Record<string, unknown>): Promise<void> {
    for (const [relationship, foreignKey] of Object.entries(entity.fks)) {
        const pairs = Object.entries(foreignKey.fields);
        const sourceValues = pairs.map(([source]) => row[source]);
        if (sourceValues.some(value => value == null)) continue;
        const result = await querySql(client,
            sql`SELECT 1 FROM ${entityTable(foreignKey.entity)} WHERE ${equalSql(pairs.map(([, destination]) => destination), sourceValues)} LIMIT 1`);
        if (!result.rows.length) {
            const columns = pairs.map(([source]) => `«${entity.fields[source]!.label}»`);
            throw new ApiFailure(400, `La referencia de la columna${columns.length === 1 ? '' : 's'} ${columns.join(', ')} no existe (${relationship}).`);
        }
    }
}

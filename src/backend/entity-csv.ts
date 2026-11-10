import type {Pool} from 'pg';
import type {EntityInfo} from 'system-definition';
import {quotePgIdentifier as quote} from '@system-definition/postgres-migrations';
import {myContext} from './system.js';
import {ApiFailure} from './api-errors.js';
import {entityTable, prepareEntityWrite} from './entity-write.js';
import {parseCsv, stringifyCsv, type CsvValue} from './csv.js';

type Entity = EntityInfo<typeof myContext>;
type CsvField = Entity['fields'][string];
type Database = Pick<Pool, 'query' | 'connect'>;
type CsvImportResult = {inserted: number; unchanged: number};

function csvFields(entity: Entity): CsvField[] {
    return Object.values(entity.fields).filter(field => field.visible && field.readable && field.writable);
}

export async function exportEntityCsv(pool: Pick<Pool, 'query'>, entity: Entity): Promise<string> {
    const availableFields = csvFields(entity);
    const fields = entity.name === 'usuarios'
        ? availableFields.filter(field => field.name === 'usuario')
        : availableFields;
    const result = await pool.query<Record<string, unknown>>(
        `SELECT ${fields.map(field => quote(field.name)).join(', ')} FROM ${entityTable(entity.name)} ORDER BY ${entity.pk.map(quote).join(', ')}`,
    );
    const rows: CsvValue[][] = [fields.map(field => field.label),
        ...result.rows.map(row => fields.map(field => row[field.name] as CsvValue))];
    return stringifyCsv(rows);
}

export async function importEntityCsv(pool: Database, entity: Entity, text: unknown): Promise<CsvImportResult> {
    if (entity.name === 'usuarios') throw new ApiFailure(403, 'No se permite importar usuarios.');
    if (typeof text !== 'string') throw new ApiFailure(400, 'Se requiere un archivo CSV.');

    const fields = csvFields(entity);
    if (fields.length !== Object.keys(entity.fields).filter(name => entity.fields[name]!.writable).length ||
        entity.pk.some(name => !fields.some(field => field.name === name))) {
        throw new Error(`CSV fields do not match editable entity fields for ${entity.name}`);
    }
    const headers = fields.map(field => field.label);

    let records: string[][];
    try {
        records = parseCsv(text);
    } catch {
        throw new ApiFailure(400, 'Error de formato en el CSV.');
    }
    if (!records.length || records[0]!.length !== headers.length ||
        records[0]!.some((header, index) => header !== headers[index])) {
        throw new ApiFailure(400, 'Los encabezados del CSV no coinciden con la entidad.');
    }

    const inputRows = records.slice(1).map(record => {
        const row: Record<string, unknown> = {};
        for (let index = 0; index < headers.length; index++) {
            const field = fields[index]!;
            const text = record[index]!;
            if (text === '') {
                row[field.inputName] = null;
                continue;
            }
            const value = myContext.behaviours[field.inputType].deserialize(text);
            if (!value.ok) throw new ApiFailure(400, 'El CSV contiene valores inválidos.');
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
            conflicts.push(`{${entity.pk.map(name => `${name}=${JSON.stringify(row[name])}`).join(', ')}}`);
        }
    };
    const equalCsvValues = (left: Record<string, unknown>, right: Record<string, unknown>) =>
        fields.every(field => Object.is(left[field.name], right[field.name]));

    for (const input of inputRows) {
        const prepared = await prepareEntityWrite(entity, input, 'create');
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
            const keyValues = entity.pk.map(name => row[name]);
            const where = entity.pk.map((name, index) => `${quote(name)} = $${index + 1}`).join(' AND ');
            const select = fields.map(field => quote(field.name)).join(', ');
            const existing = await client.query<Record<string, unknown>>(
                `SELECT ${select} FROM ${entityTable(entity.name)} WHERE ${where} FOR UPDATE`, keyValues,
            );
            if (existing.rows.length) {
                if (!equalCsvValues(existing.rows[0]!, row)) reportConflict(row);
                continue;
            }
            const names = Object.keys(row);
            const result = await client.query(
                `INSERT INTO ${entityTable(entity.name)} (${names.map(quote).join(', ')}) VALUES (${names.map((_, index) => `$${index + 1}`).join(', ')}) ` +
                `ON CONFLICT DO NOTHING RETURNING ${entity.pk.map(quote).join(', ')}`,
                names.map(name => row[name]),
            );
            if (result.rowCount) {
                inserted++;
                continue;
            }
            const raced = await client.query<Record<string, unknown>>(
                `SELECT ${select} FROM ${entityTable(entity.name)} WHERE ${where}`, keyValues,
            );
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

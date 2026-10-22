import {readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {Pool} from 'pg';
import {parseTab} from 'tab-plus';
import {completeEntity, type EntityInfo} from 'system-definition';
import {myContext, myEntities} from './system.js';
import {allowedFields} from './column-security.js';
import {prepareEntityWrite, insertPreparedRow} from './entity-write.js';

// A file names an SSOT entity and contains its public creation inputs.
export async function loadTabData(pool: Pool, directory: string): Promise<number> {
    const entities = new Map<string, EntityInfo<typeof myContext>>(Object.values(myEntities)
        .map(definition => [definition.name, completeEntity(myContext, definition)]));
    const files = (await readdir(directory)).filter(name => name.endsWith('.tab')).sort();
    if (!files.length) throw new Error('No se encontraron archivos .tab.');
    const batches = new Map(await Promise.all(files.map(async file => {
        const name = file.slice(0, -4), entity = entities.get(name);
        if (!entity) throw new Error(`${file}: planilla desconocida.`);
        const inputs = new Map(Object.values(allowedFields(entity, 'write')).map(field => [field.inputName, field]));
        const tab = parseTab(await readFile(join(directory, file), 'utf8'), {objectRows: true, strict: true});
        if (tab.fields.length !== inputs.size || tab.fields.some(field => typeof field !== 'string' || !inputs.has(field))) {
            throw new Error(`${file}: las columnas deben coincidir con los campos de creación de la API.`);
        }
        const rows = tab.rows.map((row, index) => Object.fromEntries(Object.entries(row).map(([field, text]) => {
            if (text === null) return [field, null];
            const definition = inputs.get(field)!;
            const value = typeof text === 'string' ? myContext.behaviours[definition.inputType].deserialize(text) : null;
            if (!value?.ok) throw new Error(`${file}:${index + 2}: valor inválido para ${field}.`);
            return [field, value.value];
        })));
        return [name, {entity, rows}] as const;
    })));
    const client = await pool.connect();
    let inserted = 0;
    try {
        await client.query('BEGIN');
        while (batches.size) {
            // Parents present in this import precede their children; existing DB parents are allowed.
            const ready = [...batches].find(([, {entity}]) => Object.values(entity.fks).every(fk => !batches.has(fk.entity)));
            if (!ready) throw new Error('Las referencias entre los archivos .tab forman un ciclo.');
            const [name, {entity, rows}] = ready;
            for (const row of rows) {
                await insertPreparedRow(client, entity, await prepareEntityWrite(entity, row, 'create'));
                inserted++;
            }
            batches.delete(name);
        }
        await client.query('COMMIT');
        return inserted;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally { client.release(); }
}

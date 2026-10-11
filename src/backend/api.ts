import type {Express} from 'express';
import type {Pool} from 'pg';
import {completeEntity, isRecordInstance, type EntityDef, type EntityInfo} from 'system-definition';
import {quotePgIdentifier} from '@system-definition/postgres-migrations';
import {myRecords, myEntities} from './system.js';
import type {ApiError, EntityName, EntityNamesResponse, EntityResponse} from './api-contract.js';

function isEntityName(name: string): name is EntityName {
    return Object.hasOwn(myEntities, name);
}

async function readEntity<E extends EntityName>(pool: Pool, name: E): Promise<EntityResponse<E>> {
    const definition: EntityDef<typeof myRecords> = myEntities[name];
    const entity: EntityInfo<typeof myRecords> = completeEntity(myRecords, definition);
    const fieldNames = Object.keys(entity.fields);
    const result = await pool.query<Record<string, unknown>>(`
        SELECT ${fieldNames.map(quotePgIdentifier).join(', ')}
        FROM "ssot".${quotePgIdentifier(name)}
        ORDER BY ${entity.pk.map(quotePgIdentifier).join(', ')}
    `);
    const rows = result.rows.map(row => {
        if (fieldNames.some(field => !Object.hasOwn(row, field)) || !isRecordInstance(myRecords, entity.fields, row)) {
            throw new Error(`Database row does not match the SSOT for ${name}`);
        }
        return Object.fromEntries(fieldNames.map(field => [field, row[field]]));
    });
    const columns = Object.values(entity.fields).map(({name, label, type}) => ({name, label, type}));
    // Reflection loses field literals; the SQL rows were checked using the SSOT above.
    return {name, columns, rows} as EntityResponse<E>;
}

export function registerEntityApi(app: Express, pool: Pool): void {
    app.get('/api/entities', (_, res) => {
        const names: EntityNamesResponse = Object.values(myEntities).map(entity => entity.name);
        res.json(names);
    });
    app.get('/api/entities/:name', async (req, res) => {
        const name = req.params.name;
        if (!isEntityName(name)) {
            res.status(404).json({error: 'Entidad desconocida'} satisfies ApiError);
            return;
        }
        try {
            res.json(await readEntity(pool, name));
        } catch (error) {
            console.error('Entity API query failed:', error instanceof Error ? error.message : String(error));
            res.status(500).json({error: 'No se pudieron cargar los datos.'} satisfies ApiError);
        }
    });
}

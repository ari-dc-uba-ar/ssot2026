import {Pool} from 'pg';
import {createPostgresScratch, decodeSqlSsot, generateCreate, projectSsotSchema, quotePgIdentifier as quote} from '@system-definition/postgres-migrations';
import {databaseConfig, databaseSettings} from '../../dist/backend/database.js';
import {ssot, sqlMapping} from '../../dist/backend/system.js';

const value = result => { if (!result.ok) throw new Error(JSON.stringify(result.problems)); return result.value; };

// PR #6's isolated-database approach, using the current SSOT and database settings.
export async function withTestDatabase(run) {
    const {schema} = databaseSettings.database;
    const scratch = createPostgresScratch({...databaseSettings.database, ...databaseSettings.initialUser}, [schema]);
    const handle = value(await scratch.create('clean-target'));
    let pool;
    try {
        const desired = value(projectSsotSchema(value(decodeSqlSsot(ssot, sqlMapping)), schema));
        for (const sql of value(generateCreate(desired)).statements) await handle.session.query(sql.text, sql.values);
        await handle.session.query(`GRANT USAGE ON SCHEMA ${quote(schema)} TO ${quote(databaseSettings.appUser.user)}`, []);
        await handle.session.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${quote(schema)} TO ${quote(databaseSettings.appUser.user)}`, []);
        const config = {...databaseConfig, database: handle.id};
        if (config.connectionString) {
            const url = new URL(config.connectionString);
            url.pathname = '/' + handle.id;
            config.connectionString = url.toString();
        }
        pool = new Pool(config);
        return await run({pool, config, handle});
    } finally {
        await pool?.end();
        value(await scratch.destroy(handle));
    }
}

import { connectPostgres } from '@system-definition/postgres-migrations';
import { databaseConfig, getMigrationDatabaseConfig } from './database.js';

try {
    // The migration package checks that the server is PostgreSQL 18.6.
    for (const [purpose, config] of [['app', databaseConfig], ['migration', getMigrationDatabaseConfig()]] as const) {
        const session = await connectPostgres(config);
        try {
            const result = await session.query(`
                SELECT current_database() AS database, current_user AS username,
                       current_setting('server_version') AS version
            `, []);
            console.log(JSON.stringify({purpose, ...result.rows[0]}, null, 2));
        } finally {
            await session.close();
        }
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}

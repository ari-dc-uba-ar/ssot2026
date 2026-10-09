import type { ClientConfig } from 'pg';

// pg reads PGHOST, PGPORT, PGUSER, PGPASSWORD and PGDATABASE from the environment.
// The server uses the app user; migration work uses its separate owner login.
export const databaseConfig: ClientConfig = {
    connectionTimeoutMillis: 5000,
    ...(process.env['DATABASE_URL'] ? {connectionString: process.env['DATABASE_URL']} : {}),
};

export const appDatabaseUser = process.env['DATABASE_URL']
    ? decodeURIComponent(new URL(process.env['DATABASE_URL']).username)
    : process.env['PGUSER'] ?? 'ssot2026_user';

export function getMigrationDatabaseConfig(): ClientConfig {
    const connectionString = process.env['MIGRATION_DATABASE_URL'];
    if (connectionString) return {connectionTimeoutMillis: 5000, connectionString};
    const user = process.env['MIGRATION_PGUSER'];
    const password = process.env['MIGRATION_PGPASSWORD'];
    if (!user || !password) throw new Error('Set MIGRATION_PGUSER and MIGRATION_PGPASSWORD, or MIGRATION_DATABASE_URL.');
    return {connectionTimeoutMillis: 5000, user, password};
}

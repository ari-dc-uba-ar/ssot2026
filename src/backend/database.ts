import type { ClientConfig } from 'pg';
import type { DatabaseSettings } from '@system-definition/postgres-migrations/database';

const url = process.env['DATABASE_URL'] ? new URL(process.env['DATABASE_URL']) : undefined;
export const databaseSettings = {
    database: {
        host: url?.hostname || process.env['PGHOST'] || '127.0.0.1',
        port: Number(url?.port || process.env['PGPORT'] || (url ? 5432 : 5433)),
        database: (url && decodeURIComponent(url.pathname.slice(1))) || process.env['PGDATABASE'] || 'ssot2026',
        schema: 'ssot',
        connectionTimeoutMillis: 5000,
    },
    initialUser: {
        user: process.env['POSTGRES_USER'] || 'ssot2026',
        password: process.env['POSTGRES_PASSWORD'],
    },
    owner: {
        user: process.env['MIGRATION_PGUSER'] || 'ssot2026_owner',
        password: process.env['MIGRATION_PGPASSWORD'],
    },
    appUser: {
        user: (url && decodeURIComponent(url.username)) || process.env['PGUSER'] || 'ssot2026_user',
        password: process.env['PGPASSWORD'],
        ...(process.env['DATABASE_URL'] ? {connectionString: process.env['DATABASE_URL']} : {}),
    },
} satisfies DatabaseSettings;

export const databaseConfig: ClientConfig = {
    ...databaseSettings.database,
    ...databaseSettings.appUser,
};

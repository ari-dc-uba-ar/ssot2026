import {Pool} from 'pg';
import {databaseConfig} from './database.js';
import {initializeUsers, reportInitialization} from './bootstrap.js';

const pool = new Pool(databaseConfig);
try {
    reportInitialization(await initializeUsers(pool));
} catch {
    console.error('No se pudo inicializar el primer usuario. Verificá AUTH_ADMIN_USERNAME, AUTH_ADMIN_PASSWORD (12–128 caracteres) y las migraciones.');
    process.exitCode = 1;
} finally {
    await pool.end();
}

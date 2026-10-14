import {Pool} from 'pg';
import {databaseConfig} from './database.js';
import {insertUser} from './users.js';
import {createRecoveryCodes} from './credentials.js';

const pool = new Pool(databaseConfig);
try {
    const recovery = createRecoveryCodes();
    await insertUser(pool, {usuario: process.env['AUTH_ADMIN_USERNAME'], administrador: true, activo: true}, process.env['AUTH_ADMIN_PASSWORD'], recovery.hashes);
    console.log('Administrador creado. Guardá estos códigos de recuperación; no se mostrarán de nuevo:\n' + recovery.codes.join('\n'));
} catch {
    console.error('No se pudo crear el administrador. Verificá AUTH_ADMIN_USERNAME, AUTH_ADMIN_PASSWORD (12–128 caracteres), las migraciones y que el usuario no exista.');
    process.exitCode = 1;
} finally {
    await pool.end();
}

import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {databaseConfig} from './database.js';
import {loadTabData} from './tab-data.js';

const pool = new Pool(databaseConfig);
try {
    const directory = process.argv[2] ?? fileURLToPath(new URL('../../examples/data/', import.meta.url));
    console.log(`Se cargaron ${await loadTabData(pool, directory)} filas.`);
} catch (error) {
    console.error('No se cargaron los datos:', error instanceof Error ? error.message : 'Error desconocido.');
    process.exitCode = 1;
} finally { await pool.end(); }

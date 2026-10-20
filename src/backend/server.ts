import express from 'express';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {databaseConfig} from './database.js';
import {registerEntityApi} from './api.js';
import {createAuthentication, registerAuthApi} from './auth.js';
import {initializeUsers, reportInitialization} from './bootstrap.js';
import {registerEntityEvents} from './entity-events.js';

const pool = new Pool(databaseConfig);
const app = express();
const auth = createAuthentication(pool);
const publish = registerEntityEvents(app, auth);
registerAuthApi(app, pool, auth);
registerEntityApi(app, pool, auth, publish);

app.get('/health', async (_, res) => {
    await pool.query('SELECT 1');
    res.json({ok: true});
});
app.get('/menu', (_, res) => { res.redirect('/'); });
app.use('/assets', express.static(fileURLToPath(new URL('../frontend', import.meta.url))));
app.use(express.static(fileURLToPath(new URL('../../src/frontend/public', import.meta.url))));

const port = Number(process.env['PORT'] ?? 3001);
try {
    reportInitialization(await initializeUsers(pool));
    const server = app.listen(port, () => {
        const address = server.address();
        if (address && typeof address !== 'string') console.log(`SSOT2026 escuchando en http://localhost:${address.port}`);
    });
} catch {
    console.error('No se pudo inicializar la app. Verificá las migraciones y AUTH_ADMIN_USERNAME/AUTH_ADMIN_PASSWORD para el primer arranque.');
    process.exitCode = 1;
    await pool.end();
}

import express from 'express';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {databaseConfig} from './database.js';
import {registerEntityApi} from './api.js';
import {createAuthentication, registerAuthApi} from './auth.js';

const pool = new Pool(databaseConfig);
const app = express();
const auth = createAuthentication(pool);
registerAuthApi(app, pool, auth);
registerEntityApi(app, pool, auth);

app.get('/health', async (_, res) => {
    await pool.query('SELECT 1');
    res.json({ok: true});
});
app.get('/menu', (_, res) => { res.redirect('/'); });
app.use('/assets', express.static(fileURLToPath(new URL('../frontend', import.meta.url))));
app.use(express.static(fileURLToPath(new URL('../../src/frontend/public', import.meta.url))));

const port = 3000;
app.listen(port, () => console.log(`SSOT2026 escuchando en http://localhost:${port}`));

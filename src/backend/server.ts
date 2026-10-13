import express from 'express';
import type {Request, Response, NextFunction} from 'express';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {databaseConfig} from './database.js';
import {registerEntityApi} from './api.js';

const pool = new Pool(databaseConfig);
const app = express();

// no se encriptar claves 😭
function claveCorrecta(claveRecibida: string, claveGuardada: string): boolean {
    return claveRecibida === claveGuardada;
}

function rechazar(res: Response) {
    res.set('WWW-Authenticate', 'Basic realm="SSOT2026"').status(401).send('No autorizado');
}

async function autenticar(req: Request, res: Response, next: NextFunction) {
    // está vacio?
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Basic ')) return rechazar(res);

    const decodificado = Buffer.from(header.slice('Basic '.length), 'base64').toString();

    // chequea formato (deberia ser usuario:contraseña)
    const pos = decodificado.indexOf(':');
    if (pos === -1) return rechazar(res);
    const usuario = decodificado.slice(0, pos);
    const clave = decodificado.slice(pos + 1);

    // compara contra la base de datos
    const result = await pool.query('SELECT clave FROM ssot.usuarios WHERE usuario = $1', [usuario]);
    const fila = result.rows[0];

    if (!fila || !claveCorrecta(clave, fila.clave)) return rechazar(res);

    res.locals['usuario'] = usuario;
    next();
}

// /health queda sin autenticación: el healthcheck de Docker no manda credenciales
app.get('/health', async (_, res) => {
    await pool.query('SELECT 1');
    res.json({ok: true});
});

app.use(autenticar);

registerEntityApi(app, pool);
app.get('/menu', (_, res) => { res.redirect('/'); });
app.use('/assets', express.static(fileURLToPath(new URL('../frontend', import.meta.url))));
app.use(express.static(fileURLToPath(new URL('../../src/frontend/public', import.meta.url))));

const port = 3000;
app.listen(port, () => console.log(`SSOT2026 escuchando en http://localhost:${port}`));

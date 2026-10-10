import express from "express";
import type {Request, Response, NextFunction} from 'express';
import { Pool } from 'pg'

import { completeEntity } from 'system-definition'
import { myRecords, myEntities } from './system.js';
import { databaseConfig } from './database.js';

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

app.use(express.urlencoded({ extended: true }));

app.use('/poc', autenticar);

app.get('/health', async (_, res) => {
    await pool.query('SELECT 1');
    res.json({ok: true});
});

app.get('/menu', (_, res) => {
    res.send('SSOT2026 - Solo Somos Otros Tenaces en 2026');
})

// Filtro evita crear endpoints para la tabla de usuarios
Object.values(myEntities).filter(entityDef => entityDef.name !== 'usuarios').forEach(entityDef => {
    const entity = completeEntity(myRecords, entityDef);
    const tabla = entity.name;

app.get(`/poc/lista-${tabla}`, async (_, res) => {
    const result = await pool.query(`
        SELECT ${Object.keys(entity.fields).join(',')} 
            FROM ssot.${tabla}
            ORDER BY ${entity.pk}
    `);
    res.send(`<table>
            <tr>
                ${Object.values(entity.fields).map(campo => 
                    `<th>${campo.label}</th>`
                ).join('')}
            </tr>
        ${result.rows.map((row:Record<string,any>)=>
            `<tr>
                ${Object.entries(row).map(([_, value]:string[])=>
                    `<td>${value}</td>`
                ).join('')}
            </tr>`
        ).join('')}
    </table>`)
})

app.post(`/poc/insertar-${tabla}`, async (req, res) => {
    const values = Object.values(entity.fields).map((field) => req.body[field.name]);
    const fields = Object.keys(entity.fields).join(',');

    const insertQuery = `
        INSERT INTO ssot.${tabla} (${fields})
        VALUES (${values.map((_, index) => `$${index + 1}`).join(',')})
    `;

    await pool.query(insertQuery, values);

    res.send(`
        <H2>Dato insertado</H2>
    `);
});

app.patch(`/poc/actualizar-${tabla}`, async (req, res) => {
    const values = Object.values(entity.fields).map((field) => req.body[field.name]);
    const fields = Object.keys(entity.fields);

    const updateQuery = `
        UPDATE ssot.${tabla}
        SET ${fields.map((field, index) => `${field} = $${index + 1}`).join(', ')}
        WHERE ${entity.pk.map((pkField, index) => `${pkField} = $${fields.length + index + 1}`).join(' AND ')}
    `;

    await pool.query(updateQuery, [...values, ...entity.pk.map(pkField => req.body[pkField])]);

    res.send(`
        <H2>Dato actualizado</H2>
    `);
});
app.delete(`/poc/eliminar-${tabla}`, async (req, res) => {
    const deleteQuery = `
        DELETE FROM ssot.${tabla}
        WHERE ${entity.pk.map((pkField, index) => `${pkField} = $${index + 1}`).join(' AND ')}
    `;

    await pool.query(deleteQuery, entity.pk.map(pkField => req.body[pkField]));

    res.send(`
        <H2>Dato eliminado</H2>
    `);

});
});




const port = 3000;

app.listen(port, (error) => {
    if (error) throw error;
    console.log(`SSOT2026 escuchando en http://localhost:${port}/menu`);
})

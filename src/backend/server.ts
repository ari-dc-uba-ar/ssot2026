import express from "express";
import { Pool } from 'pg'

import { completeEntity } from 'system-definition'
import { myRecords, myEntities } from './system.js';
import { databaseConfig } from './database.js';
import { selectQuery, insertQuery, updateQuery, deleteQuery } from './queries.js';

export function createApp(pool: Pool) {
const app = express();

app.use(express.urlencoded({ extended: true }));

app.get('/health', async (_, res) => {
    await pool.query('SELECT 1');
    res.json({ok: true});
});

app.get('/menu', (_, res) => {
    res.send('SSOT2026 - Solo Somos Otros Tenaces en 2026');
})

Object.values(myEntities).forEach(entityDef => {
    const entity = completeEntity(myRecords, entityDef);
    const tabla = entity.name;

app.get(`/poc/lista-${tabla}`, async (_, res) => {
    const query = selectQuery(entity);
    const result = await pool.query(query.text, query.values);
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
    const query = insertQuery(entity, req.body);
    await pool.query(query.text, query.values);

    res.send(`
        <H2>Dato insertado</H2>
    `);
});

app.patch(`/poc/actualizar-${tabla}`, async (req, res) => {
    const query = updateQuery(entity, req.body);
    await pool.query(query.text, query.values);

    res.send(`
        <H2>Dato actualizado</H2>
    `);
});
app.delete(`/poc/eliminar-${tabla}`, async (req, res) => {
    const query = deleteQuery(entity, req.body);
    await pool.query(query.text, query.values);

    res.send(`
        <H2>Dato eliminado</H2>
    `);

});
});

return app;
}

if (import.meta.main) {
    const pool = new Pool(databaseConfig);
    const app = createApp(pool);
    const port = 3000;

    app.listen(port, (error) => {
        if (error) throw error;
        console.log(`SSOT2026 escuchando en http://localhost:${port}/menu`);
    })
}

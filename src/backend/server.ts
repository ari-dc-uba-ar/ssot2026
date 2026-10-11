import express from "express";
import { Pool } from 'pg'

import { completeEntity } from 'system-definition'
import { myRecords, myEntities } from './system.js';
import { databaseConfig } from './database.js';

const pool = new Pool(databaseConfig);

const app = express();
app.use(express.static('src/frontend/dist'));
app.use(express.json());

app.get('/', (_, res) => {
    res.sendFile('index.html', { root: 'src/frontend/' });
});

app.use(express.urlencoded({ extended: true }));
app.use(express.static('src/frontend/dist'));
app.use(express.json());

app.get('/health', async (_, res) => {
    await pool.query('SELECT 1');
    res.json({ok: true});
});

app.get('/menu', (_, res) => {
    res.send('SSOT2026 - Solo Somos Otros Tenaces en 2026');
})

app.get('/', (_, res) => {
    res.sendFile('index.html', { root: 'src/frontend/' });
});

Object.values(myEntities).forEach(entityDef => {
    const entity = completeEntity(myRecords, entityDef);
    const tabla = entity.name;

app.get(`/poc/lista-${tabla}`, async (_, res) => {
    const result = await pool.query(`
        SELECT ${Object.keys(entity.fields).join(',')} 
            FROM ssot.${tabla}
            ORDER BY ${entity.pk}
    `);
    res.json(result.rows)
})

app.get(`/poc/obtener-${tabla}/:id`, async (req, res) => {
    try {
        const pk = Object.values(entity.pk).join(',');
        const pkFields = pk.split(',');

        const result = await pool.query(
            `SELECT ${Object.keys(entity.fields).join(',')}
             FROM ssot.${tabla}
             WHERE ${pkFields.map((field, index) => `${field} = $${index + 1}`).join(' AND ')}
            `,
             pkFields.map(() => req.params.id)
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Registro no encontrado' });
        }

        return res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Error al obtener el registro' });
    }
});

app.post(`/poc/insertar-${tabla}`, async (req, res) => {
    const values = Object.values(entity.fields).map((field) => req.body[field.name]);
    const fields = Object.keys(entity.fields).join(',');

    const insertQuery = `
        INSERT INTO ssot.${tabla} (${fields})
         VALUES (${values.map((_, index) => `$${index + 1}`).join(', ')})
        RETURNING *
    `;

    const result = await pool.query(insertQuery, values);
    res.status(201).json(result.rows[0]);
});

app.patch(`/poc/actualizar-${tabla}`, async (req, res) => {
    const pk = Object.values(entity.pk);

    // Solo actualizamos campos enviados y que no estén vacíos.
    const fieldsToUpdate = Object.values(entity.fields).filter(
        field =>
            !pk.includes(field.name) &&
            req.body[field.name] !== undefined &&
            req.body[field.name] !== ''
    );

    if (fieldsToUpdate.length === 0) {
        return res.status(400).json({ error: 'No hay campos para actualizar' });
    }

    const values = fieldsToUpdate.map(field => req.body[field.name]);
    const fields = fieldsToUpdate.map(field => field.name);

    const whereValues = pk.map(pkField => req.body[pkField]);

    const updateQuery = `
        UPDATE ssot.${tabla}
        SET ${fields.map((field, index) => `${field} = $${index + 1}`).join(', ')}
        WHERE ${pk.map((pkField, index) => `${pkField} = $${values.length + index + 1}`).join(' AND ')}
        RETURNING *
    `;

    const result = await pool.query(updateQuery, [...values, ...whereValues]);

    if (result.rowCount === 0) {
        return res.status(404).json({ error: 'No se encontró el registro' });
    }

    return res.json(result.rows[0]);
});

app.delete(`/poc/eliminar-${tabla}/:id`, async (req, res) => {
    const pk = Object.values(entity.pk).join(',');

    const deleteQuery = `
        DELETE FROM ssot.${tabla}
        WHERE ${pk.split(',').map((pkField, index) => `${pkField} = $${index + 1}`).join(' AND ')}
        RETURNING *
    `;

    const result = await pool.query(deleteQuery, [req.params.id]);

    if (result.rowCount === 0) {
        return res.status(404).json({ error: 'No se encontró el registro' });
    }

    return res.json(result.rows[0]);

});
});





const port = 3000;

app.listen(port, (error) => {
    if (error) throw error;
    console.log(`SSOT2026 escuchando en http://localhost:${port}/menu`);
})


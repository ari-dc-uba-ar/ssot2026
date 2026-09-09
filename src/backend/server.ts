import express from "express";
import { Pool } from 'pg'
const pool = new Pool();

const app = express();

app.use(express.urlencoded({ extended: true }));

app.get('/menu', (_, res) => {
    res.send('SSOT2026 - Solo Somos Otros Tenaces en 2026');
})

app.get('/poc/inter', (_, res) => {
    res.send(`
        <form method=post action="/poc/api/inter">
            <p>Esta es una prueba de concepto</p>
            <p><label>dato:<input name=dato></label></p>
            <input type=submit value="Procesar">
        </form>
    `)
})

app.post('/poc/api/inter', async (req, res) => {
    console.log('POST', '/poc/api/inter')
    console.log(req.query);
    res.send(`
        <H2>recibido</H2>
    `)
    console.log(await req.body);
})

app.get('/poc/lista-materias', async (_, res) => {
    const result = await pool.query(`
        SELECT cod_mat, materia, plan, obligatoria 
            FROM ssot.materias
            ORDER BY cod_mat
    `);
    res.send(`<table>
            <tr>
                ${Object.entries(result.rows[0] as string[]).map(([title]: string[])=>{
                    `<th>${title}</th>`
                }).join('')}
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

const port = 3000;

app.listen(port, (error) => {
    if (error) throw error;
    console.log(`SSOT2026 escuchando en http://localhost:${port}/menu`);
})

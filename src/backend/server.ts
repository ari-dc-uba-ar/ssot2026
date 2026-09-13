import express from "express";
import { Pool } from 'pg'
const pool = new Pool();

const app = express();

type DefTabla = {
    campos: Record<string, {tipo:string}>
    pk: string[]
}

const MATERIAS = 'ssot.materias';

const ssot = {
    tablas: {
        materias: {
            campos: {
                cod_mat     :{ tipo:'text'   },
                materia     :{ tipo:'text'   },
                obligatoria :{ tipo:'boolean'},
                plan        :{ tipo:'integer'},
            },
            pk: ['cod_mat']
        } satisfies DefTabla,
        pabellones: {
            campos: {
                pab         : {tipo:'text'},
                pabellon    : {tipo:'text'},
                pisos       : {tipo:'integer'},
            },
            pk: ['pab']
        } satisfies DefTabla
    }
}

app.use(express.urlencoded({ extended: true }));

app.get('/menu', (_, res) => {
    res.send('SSOT2026 - Solo Somos Otros Tenaces en 2026');
})

app.get('/poc/inter', (_, res) => {
    res.send(`
        <form method=post action="/poc/api/inter">
            <p>Esta es una prueba de concepto</p>
            <p><label>codigo de materia:<input name=cod_mat></label></p>
            <p><label>materia:<input name=materia></label></p>
            <p><label>plan:<input name=plan></label></p>
            <p><label>obligatoria:
                <select name=obligatoria>
                    <option value=true>si</option>
                    <option value=false>no</option>
                </select>
            </label></p>

            <input type=submit value="Agregar Materia">
        </form>
    `)
})

app.post('/poc/api/inter', async (req, res) => {
    try {
    const { cod_mat, materia, plan, obligatoria} = req.body;
    const result = await pool.query(
        `INSERT INTO ${MATERIAS} (cod_mat, materia, plan, obligatoria) VALUES ($1, $2, $3, $4) RETURNING *`,
        [cod_mat, materia, plan, obligatoria]
    );

    res.status(201).json(result.rows[0]);
    

    console.log('POST', '/poc/api/inter')
    console.log(req.query);
    res.send(`
        <H2>Materia agregada</H2>
    `)
    console.log(await req.body);
    
    } catch (error) {
    console.error('Error creating student:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/poc/api/materias', async (_, res) => {
  try {
    const result = await pool.query(`SELECT * FROM ${MATERIAS} ORDER BY cod_mat`);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching materias:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/poc/materias', (_, res) => {
    res.send(`
        <style>
            body { font-family: sans-serif; }
            table { border-collapse: collapse; margin-top: 1em; }
            th, td { border: 1px solid #ccc; padding: 6px 12px; text-align: left; }
            th { background: #f0f0f0; }
            tr:nth-child(even) { background: #fafafa; }
        </style>

        <p>Esta es una prueba de concepto</p>
        <button id="boton-materias">Ver materias</button>
        <div id="resultado-materias"></div>
        
        <script>
            document.getElementById('boton-materias').addEventListener('click', async () => {
                const respuesta = await fetch('/poc/api/materias');
                const materias = await respuesta.json();
                const contenedor = document.getElementById('resultado-materias');
                if (materias.length === 0) {
                    contenedor.textContent = 'No hay materias cargadas.';
                    return;
                }
                const columnas = Object.keys(materias[0]);
                contenedor.innerHTML = \`<table>
                    <tr>\${columnas.map(col => \`<th>\${col}</th>\`).join('')}</tr>
                    \${materias.map(materia => \`<tr>\${columnas.map(col => \`<td>\${materia[col]}</td>\`).join('')}</tr>\`).join('')}
                </table>\`;
            });
        </script>
    `)
})

Object.entries(ssot.tablas).forEach(([tabla, def]: [string, DefTabla]) => {

app.get(`/poc/lista-${tabla}`, async (_, res) => {
    const result = await pool.query(`
        SELECT ${Object.keys(def.campos).join(',')} 
            FROM ssot.${tabla}
            ORDER BY ${def.pk}
    `);
    res.send(`<table>
            <tr>
                ${Object.keys(def.campos).map(title => 
                    `<th>${title}</th>`
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
})

const port = 3000;

app.listen(port, (error) => {
    if (error) throw error;
    console.log(`SSOT2026 escuchando en http://localhost:${port}/menu`);
})

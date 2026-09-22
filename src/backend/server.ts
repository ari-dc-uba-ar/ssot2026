import express from 'express';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env['PORT'] || 3000;

const pool = new Pool({
    host: process.env['DB_HOST'],
    port: parseInt(process.env['DB_PORT'] || '5432', 10),
    database: process.env['DB_NAME'],
    user: process.env['DB_USER'],
    password: process.env['DB_PASSWORD'],
});

// ============================================================================
// 1. FUENTE ÚNICA DE LA VERDAD (SSOT)
// ============================================================================

export type TipoDato = 'text' | 'integer' | 'boolean';

export type CampoDef = {
    readonly tipo: TipoDato;
    readonly opciones?: readonly (string | number)[];
};

export type DefTabla = {
    readonly campos: Record<string, CampoDef>;
    readonly pk: readonly string[];
};

export const ssot = {
    tablas: {
        materias: {
            campos: {
                cod_mat: { tipo: 'text' },
                materia: { tipo: 'text' },
                obligatoria: { tipo: 'boolean' },
                plan: { tipo: 'integer', opciones: [1993, 2023] },
            },
            pk: ['cod_mat'],
        },
        pabellones: {
            campos: {
                pab: { tipo: 'text' },
                pabellon: { tipo: 'text' },
                pisos: { tipo: 'integer' },
            },
            pk: ['pab'],
        },
    },
} satisfies { tablas: Record<string, DefTabla> };

// ============================================================================
// 2. ADAPTADOR DE TIPOS Y VALIDACIÓN
// ============================================================================

const casters: Record<TipoDato, (v: unknown) => string | number | boolean | null> = {
    text: (v) => (v === undefined || v === null || v === '' ? null : String(v).trim()),
    integer: (v) => {
        if (v === undefined || v === null || v === '') return null;
        const n = parseInt(String(v), 10);
        return Number.isNaN(n) ? null : n;
    },
    boolean: (v) => v === true || v === 'true' || v === 'on',
};

function castear(valor: unknown, tipo: TipoDato) {
    return casters[tipo](valor);
}

function validarOpciones(col: string, valor: unknown, campo: CampoDef) {
    if (campo.opciones && campo.opciones.length > 0) {
        const esValido = campo.opciones.some(opt => String(opt) === String(valor));
        if (!esValido) {
            throw new Error(`Valor "${valor}" inválido para la columna "${col}". Opciones permitidas: [${campo.opciones.join(', ')}]`);
        }
    }
}

function renderInput(nombreCol: string, campo: CampoDef, valor: unknown, esPk: boolean): string {
    if (esPk) {
        return `
            <span style="font-weight: bold; color: #333; padding: 3px 0;">${valor ?? ''}</span>
            <input type="hidden" name="${nombreCol}" value="${valor ?? ''}">
        `;
    }

    if (campo.opciones && campo.opciones.length > 0) {
        return `
            <select name="${nombreCol}" required>
                ${campo.opciones.map(opt => `
                    <option value="${opt}" ${String(valor) === String(opt) ? 'selected' : ''}>${opt}
                    </option>
                `).join('')}
            </select>
        `;
    }

    if (campo.tipo === 'boolean') {
        const checked = valor === true || valor === 't' ? 'checked' : '';
        return `<input type="checkbox" name="${nombreCol}" value="true" ${checked}>`;
    }
    if (campo.tipo === 'integer') {
        return `<input type="number" name="${nombreCol}" value="${valor ?? ''}" required>`;
    }
    return `<input type="text" name="${nombreCol}" value="${valor ?? ''}" required>`;
}

// ============================================================================
// 3. EXPRESS Y ENDPOINTS
// ============================================================================

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Menú principal
app.get('/menu', (_, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>SSOT2026 - Menú</title>
            <style>
                body { font-family: sans-serif; margin: 2rem; }
                ul { line-height: 1.8; }
            </style>
        </head>
        <body>
            <h2>SSOT2026 - Solo Somos Otros Tenaces</h2>
            <h3>Tablas disponibles:</h3>
            <ul>
                ${Object.keys(ssot.tablas).map(tabla => `
                    <li>
                        <strong>${tabla}:</strong> 
                        <a href="/poc/lista-${tabla}">Ver listado</a>
                    </li>
                `).join('')}
            </ul>
            <br>
            <a href="/poc/inter">Ir al formulario de prueba de materias</a>
        </body>
        </html>
    `);
});

// Formulario manual de prueba para materias
app.get('/poc/inter', (_, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>Registrar Materia</title>
            <style>
                body { font-family: sans-serif; margin: 2rem; }
                form { display: flex; flex-direction: column; width: 300px; gap: 10px; }
                label { display: flex; justify-content: space-between; align-items: center; }
                select { width: 160px; padding: 2px; }
            </style>
        </head>
        <body>
            <h2>Registrar Materia</h2>
            <form method="POST" action="/poc/materias/crear">
                <label>
                    Código:
                    <input type="text" name="cod_mat" required placeholder="Ej: BD">
                </label>
                <label>
                    Materia:
                    <input type="text" name="materia" required placeholder="Ej: Base de Datos">
                </label>
                <label>
                    Plan:
                    <select name="plan" required>
                        <option value="" disabled selected>Seleccione un plan</option>
                        <option value="1993">1993</option>
                        <option value="2023">2023</option>
                    </select>
                </label>
                <label>
                    Obligatoria:
                    <input type="checkbox" name="obligatoria" value="true">
                </label>
                <button type="submit">Guardar Materia</button>
            </form>
            <br>
            <a href="/poc/lista-materias">Ver lista de materias</a>
            <br>
            <a href="/menu">Volver al menú</a>
        </body>
        </html>
    `);
});

// Generador genérico de endpoints CRUD por cada tabla del SSOT
Object.entries(ssot.tablas).forEach(([tabla, def]: [string, DefTabla]) => {
    const columnas = Object.keys(def.campos);

    // 1. LISTAR (con acciones de Editar y Eliminar con confirmación)
    app.get(`/poc/lista-${tabla}`, async (_, res) => {
        try {
            const result = await pool.query(`
                SELECT ${columnas.join(', ')} 
                FROM ssot.${tabla} 
                ORDER BY ${def.pk.join(', ')}
            `);

            res.send(`
                <h2>Listado de ${tabla}</h2>
                <table border="1" cellpadding="6" style="border-collapse: collapse;">
                    <tr>
                        ${columnas.map(title => `<th>${title}</th>`).join('')}
                        <th>Acciones</th>
                    </tr>
                    ${result.rows.map((row: Record<string, unknown>) => {
                        const pkParams = def.pk.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(row[k]))}`).join('&');
                        const pkResumen = def.pk.map(k => `${k}='${row[k]}'`).join(', ');

                        return `
                            <tr>
                                ${columnas.map(col => `<td>${row[col] ?? ''}</td>`).join('')}
                                <td>
                                    <a href="/poc/form-editar-${tabla}?${pkParams}">Editar</a>
                                    |
                                    <form method="POST" action="/poc/${tabla}/eliminar" style="display:inline;" onsubmit="return confirm('¿Está seguro de eliminar (${pkResumen})?');">
                                        ${def.pk.map(k => `<input type="hidden" name="${k}" value="${row[k] ?? ''}">`).join('')}
                                        <button type="submit" style="background:none; border:none; color:red; text-decoration:underline; cursor:pointer; padding:0; font:inherit;">
                                            Eliminar
                                        </button>
                                    </form>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </table>
                <br>
                <a href="/menu">Volver al menú</a>
            `);
        } catch (error) {
            console.error(`Error al listar ${tabla}:`, error);
            res.status(500).send(`Error: ${(error as Error).message}`);
        }
    });

    // 2. CREAR (INSERT) con validación
    app.post(`/poc/${tabla}/crear`, async (req, res) => {
        try {
            const valores = columnas.map(col => {
                const campo = def.campos[col];
                if (!campo) throw new Error(`Columna "${col}" no encontrada.`);
                
                const valorCasteado = castear(req.body[col], campo.tipo);
                validarOpciones(col, valorCasteado, campo);

                return valorCasteado;
            });

            const placeholders = columnas.map((_, i) => `$${i + 1}`).join(', ');
            const query = `
                INSERT INTO ssot.${tabla} (${columnas.join(', ')})
                VALUES (${placeholders})
                RETURNING *
            `;

            const result = await pool.query(query, valores);

            res.send(`
                <h3>Registro creado con éxito en ssot.${tabla}</h3>
                <pre>${JSON.stringify(result.rows[0], null, 2)}</pre>
                <p>
                    <a href="/poc/inter">Volver al formulario</a> | 
                    <a href="/poc/lista-${tabla}">Ver listado de ${tabla}</a> | 
                    <a href="/menu">Menú principal</a>
                </p>
            `);
        } catch (error) {
            console.error(`Error al insertar en ${tabla}:`, error);
            res.status(500).send(`
                <h3 style="color: red;">Error al insertar en ${tabla}</h3>
                <p>${(error as Error).message}</p>
                <a href="/poc/inter">Volver</a>
            `);
        }
    });

    // 3. FORMULARIO DE EDICIÓN
    app.get(`/poc/form-editar-${tabla}`, async (req, res) => {
        try {
            const whereClause = def.pk.map((k, i) => `${k} = $${i + 1}`).join(' AND ');
            const valoresPk = def.pk.map(k => {
                const campo = def.campos[k];
                if (!campo) throw new Error(`PK "${k}" no encontrada.`);
                return castear(req.query[k], campo.tipo);
            });

            const result = await pool.query(
                `SELECT ${columnas.join(', ')} FROM ssot.${tabla} WHERE ${whereClause} LIMIT 1`,
                valoresPk
            );

            if (result.rows.length === 0) {
                res.status(404).send('Registro no encontrado.');
                return;
            }

            const registro = result.rows[0] as Record<string, unknown>;

            res.send(`
                <!DOCTYPE html>
                <html lang="es">
                <head>
                    <meta charset="UTF-8">
                    <title>Editar ${tabla}</title>
                    <style>
                        body { font-family: sans-serif; margin: 2rem; }
                        form { display: flex; flex-direction: column; width: 320px; gap: 10px; }
                        label { display: flex; justify-content: space-between; align-items: center; }
                        input[type="text"], input[type="number"], select { width: 160px; padding: 2px; }
                    </style>
                </head>
                <body>
                    <h2>Editar ${tabla}</h2>
                    <form method="POST" action="/poc/${tabla}/actualizar">
                        ${columnas.map(col => {
                            const campo = def.campos[col];
                            if (!campo) return '';
                            const esPk = def.pk.includes(col);
                            return `
                                <label>
                                    ${col}${esPk ? ' (PK)' : ''}:
                                    ${renderInput(col, campo, registro[col], esPk)}
                                </label>
                            `;
                        }).join('')}
                        <button type="submit" style="margin-top: 10px;">Guardar Cambios</button>
                    </form>
                    <br>
                    <a href="/poc/lista-${tabla}">Cancelar y volver</a>
                </body>
                </html>
            `);
        } catch (error) {
            console.error(`Error al cargar datos para edición en ${tabla}:`, error);
            res.status(500).send(`Error: ${(error as Error).message}`);
        }
    });

    // 4. ACTUALIZAR (UPDATE) con validación
    app.post(`/poc/${tabla}/actualizar`, async (req, res) => {
        try {
            const colsModificables = columnas.filter(c => !def.pk.includes(c));

            if (colsModificables.length === 0) {
                res.status(400).send('No hay columnas editables fuera de la clave primaria.');
                return;
            }

            const valoresSet = colsModificables.map(c => {
                const campo = def.campos[c];
                if (!campo) throw new Error(`Columna "${c}" no encontrada.`);

                const valorCasteado = castear(req.body[c], campo.tipo);
                validarOpciones(c, valorCasteado, campo);

                return valorCasteado;
            });

            const valoresPk = def.pk.map(c => {
                const campo = def.campos[c];
                if (!campo) throw new Error(`PK "${c}" no encontrada.`);
                return castear(req.body[c], campo.tipo);
            });

            const setClause = colsModificables.map((c, i) => `${c} = $${i + 1}`).join(', ');
            const offset = colsModificables.length;
            const whereClause = def.pk.map((c, i) => `${c} = $${offset + i + 1}`).join(' AND ');

            const query = `
                UPDATE ssot.${tabla} 
                SET ${setClause} 
                WHERE ${whereClause} 
                RETURNING *
            `;

            const result = await pool.query(query, [...valoresSet, ...valoresPk]);

            if (result.rowCount === 0) {
                res.status(404).send('Registro no encontrado para actualizar.');
                return;
            }

            res.send(`
                <h3>Registro actualizado con éxito en ssot.${tabla}</h3>
                <pre>${JSON.stringify(result.rows[0], null, 2)}</pre>
                <p>
                    <a href="/poc/lista-${tabla}">Volver al listado de ${tabla}</a> | 
                    <a href="/menu">Menú principal</a>
                </p>
            `);
        } catch (error) {
            console.error(`Error al actualizar en ${tabla}:`, error);
            res.status(500).send(`
                <h3 style="color: red;">Error al actualizar en ${tabla}</h3>
                <p>${(error as Error).message}</p>
                <a href="/poc/lista-${tabla}">Volver al listado</a>
            `);
        }
    });

    // 5. ELIMINAR (DELETE genérico)
    app.post(`/poc/${tabla}/eliminar`, async (req, res) => {
        try {
            const valoresPk = def.pk.map(c => {
                const campo = def.campos[c];
                if (!campo) throw new Error(`PK "${c}" no encontrada.`);
                return castear(req.body[c], campo.tipo);
            });

            const whereClause = def.pk.map((c, i) => `${c} = $${i + 1}`).join(' AND ');
            const query = `DELETE FROM ssot.${tabla} WHERE ${whereClause} RETURNING *`;

            const result = await pool.query(query, valoresPk);

            if (result.rowCount === 0) {
                res.status(404).send('Registro no encontrado para eliminar.');
                return;
            }

            res.redirect(`/poc/lista-${tabla}`);
        } catch (error) {
            console.error(`Error al eliminar en ${tabla}:`, error);
            res.status(500).send(`
                <h3 style="color: red;">Error al eliminar en ${tabla}</h3>
                <p>${(error as Error).message}</p>
                <a href="/poc/lista-${tabla}">Volver al listado</a>
            `);
        }
    });

});

app.listen(port, () => {
    console.log(`SSOT2026 escuchando en http://localhost:${port}/menu`);
});
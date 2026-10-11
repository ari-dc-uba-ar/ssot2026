import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import test from 'node:test';
import {Pool} from 'pg';
import {createPostgresScratch} from '@system-definition/postgres-migrations';
import {databaseConfig, getMigrationDatabaseConfig} from '../dist/backend/database.js';
import {valueOf} from '../dist/backend/initial-migration.js';
import {selectQuery, insertQuery, updateQuery, deleteQuery} from '../dist/backend/queries.js';
import {ensureInitialInstallation} from '../dist/backend/release-installation.js';
import {createApp} from '../dist/backend/server.js';

function forDatabase(config, database) {
    const result = {...config, database};
    if (result.connectionString) {
        const url = new URL(result.connectionString);
        url.pathname = '/' + database;
        result.connectionString = url.toString();
    }
    return result;
}

async function withServer(run) {
    const scratch = createPostgresScratch(getMigrationDatabaseConfig(), ['ssot']);
    const handle = valueOf(await scratch.create('clean-target'));
    let pool;
    let server;
    try {
        await ensureInitialInstallation(forDatabase(getMigrationDatabaseConfig(), handle.id));
        pool = new Pool(forDatabase(databaseConfig, handle.id));
        const app = createApp(pool);
        server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        const baseUrl = `http://127.0.0.1:${address.port}`;
        await run(baseUrl, pool);
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        await pool?.end();
        valueOf(await scratch.destroy(handle));
    }
}

test('el servidor arranca directamente con node ./dist/backend/server y responde en el puerto 3000', async () => {
    const scratch = createPostgresScratch(getMigrationDatabaseConfig(), ['ssot']);
    const handle = valueOf(await scratch.create('clean-target'));
    let child;
    try {
        await ensureInitialInstallation(forDatabase(getMigrationDatabaseConfig(), handle.id));
        child = spawn(process.execPath, ['./dist/backend/server'], {
            env: {...process.env, PGDATABASE: handle.id},
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        await new Promise((resolve, reject) => {
            child.stdout.on('data', chunk => {
                if (chunk.toString().includes('SSOT2026 escuchando')) resolve();
            });
            child.once('error', reject);
            child.once('exit', code => reject(new Error(`Server salio antes de escuchar con codigo ${code}`)));
        });

        const healthRes = await fetch('http://127.0.0.1:3000/health');
        assert.equal(healthRes.status, 200);
        assert.deepEqual(await healthRes.json(), {ok: true});

        const listaRes = await fetch('http://127.0.0.1:3000/poc/lista-materias');
        assert.equal(listaRes.status, 200);
        assert.match(await listaRes.text(), /<table>/);
    } finally {
        if (child && child.exitCode === null) {
            child.kill('SIGTERM');
            await once(child, 'exit');
        }
        valueOf(await scratch.destroy(handle));
    }
});

test('endpoints de health y menu responden correctamente', async () => {
    await withServer(async (baseUrl) => {
        const healthRes = await fetch(`${baseUrl}/health`);
        assert.equal(healthRes.status, 200);
        assert.deepEqual(await healthRes.json(), {ok: true});

        const menuRes = await fetch(`${baseUrl}/menu`);
        assert.equal(menuRes.status, 200);
        assert.match(await menuRes.text(), /SSOT2026/);
    });
});

test('endpoints CRUD', async (t) => {
    await withServer(async (baseUrl, pool) => {
        await t.test('POST /poc/insertar-materias inserta registros', async () => {
            const resSim = await fetch(`${baseUrl}/poc/insertar-materias`, {
                method: 'POST',
                body: new URLSearchParams({cod_mat: 'SIM', materia: 'Simulacion', obligatoria: 'false'}),
            });
            assert.equal(resSim.status, 200);

            const resBd = await fetch(`${baseUrl}/poc/insertar-materias`, {
                method: 'POST',
                body: new URLSearchParams({cod_mat: 'ARI', materia: 'Base de Datos', obligatoria: 'true'}),
            });
            assert.equal(resBd.status, 200);
            assert.match(await resBd.text(), /Dato insertado/);
        });

        await t.test('GET /poc/lista-materias devuelve la tabla ordenada por PK', async () => {
            const listRes = await fetch(`${baseUrl}/poc/lista-materias`);
            assert.equal(listRes.status, 200);
            const listHtml = await listRes.text();
            assert.match(listHtml, /<th>cod mat<\/th>/);
            assert.ok(listHtml.indexOf('Base de Datos') < listHtml.indexOf('Simulacion'));
        });

        await t.test('PATCH /poc/actualizar-materias actualiza parcialmente sin pisar otras columnas ni filas', async () => {
            const updateRes = await fetch(`${baseUrl}/poc/actualizar-materias`, {
                method: 'PATCH',
                body: new URLSearchParams({materia: 'Base de Datos', obligatoria: 'false'}),
            });
            assert.equal(updateRes.status, 200);
            assert.match(await updateRes.text(), /Dato actualizado/);

            const rowsAfterUpdate = (await pool.query('SELECT cod_mat, materia, obligatoria FROM ssot.materias ORDER BY materia')).rows;
            assert.deepEqual(rowsAfterUpdate, [
                {cod_mat: 'ARI', materia: 'Base de Datos', obligatoria: false},
                {cod_mat: 'SIM', materia: 'Simulacion', obligatoria: false},
            ]);
        });

        await t.test('DELETE /poc/eliminar-materias elimina solo la fila indicada', async () => {
            const deleteRes = await fetch(`${baseUrl}/poc/eliminar-materias`, {
                method: 'DELETE',
                body: new URLSearchParams({materia: 'Base de Datos'}),
            });
            assert.equal(deleteRes.status, 200);
            assert.match(await deleteRes.text(), /Dato eliminado/);

            const remaining = (await pool.query('SELECT cod_mat, materia FROM ssot.materias')).rows;
            assert.deepEqual(remaining, [{cod_mat: 'SIM', materia: 'Simulacion'}]);
        });
    });
});

const aulasEntity = {
    name: 'aulas',
    fields: {
        pab: {name: 'pab'},
        aula: {name: 'aula'},
        capacidad: {name: 'capacidad'},
    },
    pk: ['pab', 'aula'],
};

test('insertQuery arma el INSERT parametrizado con todos los campos', () => {
    assert.deepEqual(insertQuery(aulasEntity, {pab: 'P1', aula: '104', capacidad: 80}), {
        text: 'INSERT INTO ssot.aulas (pab, aula, capacidad) VALUES ($1, $2, $3)',
        values: ['P1', '104', 80],
    });
});

test('selectQuery arma el SELECT ordenado por clave primaria', () => {
    assert.deepEqual(selectQuery(aulasEntity), {
        text: 'SELECT pab, aula, capacidad FROM ssot.aulas ORDER BY pab, aula',
        values: [],
    });
});

test('updateQuery incluye en SET solo los campos enviados y filtra por clave primaria', () => {
    assert.deepEqual(updateQuery(aulasEntity, {pab: 'P1', aula: '104', capacidad: 100}), {
        text: 'UPDATE ssot.aulas SET capacidad = $1 WHERE pab = $2 AND aula = $3',
        values: [100, 'P1', '104'],
    });
});

test('deleteQuery filtra por todos los campos de la clave primaria', () => {
    assert.deepEqual(deleteQuery(aulasEntity, {pab: 'P1', aula: '104'}), {
        text: 'DELETE FROM ssot.aulas WHERE pab = $1 AND aula = $2',
        values: ['P1', '104'],
    });
});

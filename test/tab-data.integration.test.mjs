import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withTestDatabase} from './helpers/database.mjs';
import {loadTabData} from '../dist/backend/tab-data.js';

test('tab-plus imports use SSOT types, FK order and atomic app-user writes', async () => {
    await withTestDatabase(async ({pool}) => {
        assert.equal(await loadTabData(pool, 'examples/data'), 12);
        assert.deepEqual((await pool.query("SELECT nota, regularidad FROM ssot.enrolamientos WHERE legajo='E002'")).rows, [{nota: null, regularidad: null}]);
        assert.deepEqual((await pool.query("SELECT plan, obligatoria FROM ssot.materias WHERE cod_mat='LOG'")).rows, [{plan: 1993, obligatoria: false}]);
        const before = (await pool.query('SELECT * FROM ssot.planes ORDER BY plan')).rows;
        await assert.rejects(loadTabData(pool, 'examples/data'), {code: '23505'});
        assert.deepEqual((await pool.query('SELECT * FROM ssot.planes ORDER BY plan')).rows, before);
        const directory = await mkdtemp(join(tmpdir(), 'ssot-tab-'));
        try {
            // The first insert succeeds, but a later FK violation must roll it back.
            await writeFile(join(directory, 'planes.tab'), 'plan|descripcion\n2050|New plan\n');
            await writeFile(join(directory, 'materias.tab'), 'cod_mat|cod_dep|materia|plan|obligatoria\nNEW|MISSING|New|2050|true\n');
            await assert.rejects(loadTabData(pool, directory), {code: '23503'});
            assert.deepEqual((await pool.query('SELECT * FROM ssot.planes ORDER BY plan')).rows, before);
            await writeFile(join(directory, 'materias.tab'), 'cod_mat|cod_dep|materia|plan|obligatoria\nNEW|DC|New|1993|true\n');
            await assert.rejects(loadTabData(pool, directory), /1993/);
            assert.deepEqual((await pool.query('SELECT * FROM ssot.planes ORDER BY plan')).rows, before);
            await writeFile(join(directory, 'planes.tab'), 'plan|descripcion\nnot-a-number|Bad\n');
            await assert.rejects(loadTabData(pool, directory), /valor inválido/);
            await writeFile(join(directory, 'planes.tab'), 'plan|secret\n1|Bad\n');
            await assert.rejects(loadTabData(pool, directory), /columnas/);
        } finally {
            // Exact temporary directory created by this test; no repository or DB data removed.
            await rm(directory, {recursive: true, force: true});
        }
    });
});

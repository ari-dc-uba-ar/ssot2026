import assert from 'node:assert/strict';
import test from 'node:test';
import {decodeSystemSnapshot} from 'system-definition';
import {assessDatabase, assessSchema, createPostgresScratch, generateCreate, projectSsotSchema} from '@system-definition/postgres-migrations';
import {ssot, myRecords} from '../dist/backend/system.js';
import {databaseSettings} from '../dist/backend/database.js';

const value = result => {if (!result.ok) throw new Error(JSON.stringify(result.problems)); return result.value;};

test('assessment reports live schema differences without changing schema or data', async () => {
    const {schema} = databaseSettings.database;
    const scratch = createPostgresScratch({...databaseSettings.database,
        user: databaseSettings.owner, password: process.env.MIGRATION_PGPASSWORD}, [schema]);
    const handle = value(await scratch.create('clean-target'));
    try {
        const expected = value(projectSsotSchema(ssot, schema));
        const empty = value(await assessSchema(ssot, schema, handle.session));
        assert.ok(!empty.differences.some(diff => diff.path.length === 1 && diff.path[0] === 'schemas'));
        assert.ok(empty.differences.some(diff => diff.change === 'add'));
        for (const statement of value(generateCreate(expected)).statements) await handle.session.query(statement.text, statement.values);
        await handle.session.query("INSERT INTO ssot.materias (materia, obligatoria) VALUES ('Keep this row', false)", []);
        assert.deepEqual(value(await assessSchema(ssot, schema, handle.session)), {equal: true, differences: []});
        const absent = value(await assessSchema(ssot, 'missing_schema', handle.session));
        assert.ok(absent.differences.some(diff => diff.path.length === 1 && diff.path[0] === 'schemas'));

        const target = structuredClone(ssot);
        target.entities.materias.fields.notes = myRecords.completeField({type: 'text'}, 'notes');
        target.records.materia.notes = target.entities.materias.fields.notes;
        const changed = value(decodeSystemSnapshot(target));
        const missing = value(await assessSchema(changed, schema, handle.session));
        assert.equal(missing.equal, false);
        assert.ok(missing.differences.some(diff => diff.change === 'add' && diff.path.at(-1) === 'notes'));
        assert.equal(missing.differences.find(diff => diff.path.at(-1) === 'notes').impact, 'preserving');
        assert.equal((await handle.session.query("SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema = $1 AND column_name = 'notes'", [schema])).rows[0].count, 0);

        target.entities.materias.fields.cod_mat.nullable = false;
        target.records.materia.cod_mat.nullable = false;
        const required = value(await assessSchema(value(decodeSystemSnapshot(target)), schema, handle.session));
        assert.ok(required.differences.some(diff => diff.path.includes('cod_mat') && diff.path.at(-1) === 'nullable' && diff.impact === 'requiresDataCheck'));
        assert.equal((await handle.session.query('SELECT cod_mat FROM ssot.materias', [])).rows[0].cod_mat, null);

        await handle.session.query('ALTER TABLE ssot.materias ADD COLUMN extra integer', []);
        await handle.session.query('ALTER TABLE ssot.materias ALTER COLUMN obligatoria SET NOT NULL', []);
        await handle.session.query('CREATE INDEX extra_index ON ssot.materias (cod_mat)', []);
        const drift = value(await assessSchema(ssot, schema, handle.session));
        assert.ok(drift.differences.some(diff => diff.change === 'remove' && diff.path.at(-1) === 'extra'));
        assert.equal(drift.differences.find(diff => diff.path.at(-1) === 'extra').impact, 'destructive');
        assert.equal(drift.differences.find(diff => diff.path.at(-1) === 'extra_index').impact, 'preserving');
        assert.ok(drift.differences.some(diff => diff.change === 'remove' && diff.path.at(-1) === 'extra_index'));
        assert.ok(drift.differences.some(diff => diff.change === 'change' && diff.path.at(-1) === 'nullable' && diff.before === false && diff.after === true));
        assert.equal((await handle.session.query('SELECT materia FROM ssot.materias', [])).rows[0].materia, 'Keep this row');
        assert.equal((await handle.session.query("SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema = $1 AND column_name = 'extra'", [schema])).rows[0].count, 1);
    } finally {value(await scratch.destroy(handle));}
});

test('the configured live database already matches the SSOT', async () => {
    assert.deepEqual(value(await assessDatabase(ssot, databaseSettings)), {equal: true, differences: []});
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {sql, identifier, joinSql, equalSql, compileSql} from '../dist/backend/sql.js';

test('SQL composition binds hostile values, nulls and nested fragments without placeholder collisions', () => {
    const value = "'); DROP TABLE records; -- $1";
    const predicate = equalSql(['key', 'part'], [value, null]);
    const result = compileSql(sql`UPDATE ${identifier('odd"schema', 'records')} SET ${joinSql([
        sql`${identifier('text')} = ${value}`, sql`${identifier('array')} = ${[1, 2]}`,
    ])} WHERE (${predicate}) OR (${predicate})`);
    assert.equal(result.text, 'UPDATE "odd""schema"."records" SET "text" = $1, "array" = $2 WHERE ("key" = $3 AND "part" = $4) OR ("key" = $5 AND "part" = $6)');
    assert.deepEqual(result.values, [value, [1, 2], value, null, value, null]);
    assert.deepEqual(compileSql(sql`SELECT ${'count(*)'}`), {text: 'SELECT $1', values: ['count(*)']});
    assert.equal(compileSql(sql`SELECT '$1', ${value}`).text, "SELECT '$1', $1");
});

import type {Pool, QueryResultRow} from 'pg';
import {quotePgIdentifier} from '@system-definition/postgres-migrations';
import {databaseSettings} from './database.js';

type Part = string | {value: unknown};
class Sql {
    readonly parts: readonly Part[];
    constructor(parts: readonly Part[]) { this.parts = parts; }
}

// Only tagged literals and quoted identifiers are SQL. Every other interpolation is data.
export function sql(strings: TemplateStringsArray, ...values: unknown[]): Sql {
    return new Sql(strings.flatMap((text, index): Part[] => index === values.length ? [text]
        : [text, ...(values[index] instanceof Sql ? values[index].parts : [{value: values[index]}])]));
}
export const identifier = (...names: string[]): Sql => new Sql([names.map(quotePgIdentifier).join('.')]);
export const entityTable = (name: string): Sql => identifier(databaseSettings.database.schema, name);
export const joinSql = (parts: readonly Sql[], separator = sql`, `): Sql =>
    new Sql(parts.flatMap((part, index) => [...(index ? separator.parts : []), ...part.parts]));
export const equalSql = (names: readonly string[], values: readonly unknown[], alias?: string): Sql =>
    joinSql(names.map((name, index) => sql`${identifier(...(alias ? [alias, name] : [name]))} = ${values[index]}`), sql` AND `);

export function compileSql(statement: Sql) {
    const values: unknown[] = [];
    const text = statement.parts.map(part => {
        if (typeof part === 'string') return part;
        values.push(part.value);
        return `$${values.length}`;
    }).join('');
    return {text, values};
}
export function querySql<Row extends QueryResultRow = QueryResultRow>(db: Pick<Pool, 'query'>, statement: Sql) {
    const {text, values} = compileSql(statement);
    return db.query<Row>(text, values);
}

import type {Pool} from 'pg';
import {sql, identifier, entityTable, joinSql, querySql} from './sql.js';
import type {EntityName, StoredRow} from './api-contract.js';

/** Static backend queries use SSOT field names; values remain SQL parameters. */
export function entitySql<E extends EntityName>(name: E) {
    type Field = keyof StoredRow<E> & string;
    const table = entityTable(name);
    const column = (field: Field) => identifier(field);
    return {
        table, column,
        select<const Fields extends readonly [Field, ...Field[]]>(...fields: Fields) {
            return {
                fields,
                query(db: Pick<Pool, 'query'>, suffix = sql``) {
                    return querySql<Pick<StoredRow<E>, Fields[number]>>(db,
                        sql`SELECT ${joinSql(fields.map(column))} FROM ${table} ${suffix}`);
                },
            };
        },
    };
}

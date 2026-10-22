import type {Pool} from 'pg';
import {quotePgIdentifier as quote} from '@system-definition/postgres-migrations';
import type {EntityName, StoredRow} from './api-contract.js';
import {entityTable} from './entity-write.js';

/** Static backend queries use SSOT field names; values remain SQL parameters. */
export function entitySql<E extends EntityName>(name: E) {
    type Field = keyof StoredRow<E> & string;
    const table = entityTable(name);
    const column = (field: Field): string => quote(field);
    return {
        table, column,
        select<const Fields extends readonly [Field, ...Field[]]>(...fields: Fields) {
            return {
                fields,
                query(db: Pick<Pool, 'query'>, suffix = '', values: unknown[] = []) {
                    return db.query<Pick<StoredRow<E>, Fields[number]>>(
                        `SELECT ${fields.map(column).join(', ')} FROM ${table} ${suffix}`, values);
                },
            };
        },
    };
}

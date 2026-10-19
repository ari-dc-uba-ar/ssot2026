import type {Pool} from 'pg';
import type {EntityInfo} from 'system-definition';
import {instanceProblems} from 'system-definition';
import {quotePgIdentifier as quote} from '@system-definition/postgres-migrations';
import {myContext, sqlMapping} from './system.js';
import {ApiFailure, readObject} from './api-errors.js';
import {entityTable} from './entity-write.js';
import {browsing} from './browsing.js';
import type {EntityQuery, EntityWindow} from './api-contract.js';

type Fields = EntityInfo<typeof myContext>['fields'];
export function readQuery(value: unknown, fields: Fields): EntityQuery {
    const input = readObject(value, [], ['filter', 'sort', 'direction', 'page', 'where']);
    const {filter = '', sort, direction = 'asc', page = 1, where = {}} = input;
    if (typeof filter !== 'string' || (sort !== undefined && (typeof sort !== 'string' || !Object.hasOwn(fields, sort))) ||
        (direction !== 'asc' && direction !== 'desc') || !Number.isSafeInteger(page) || Number(page) < 1 || Number(page) > 2147483647) {
        throw new ApiFailure(400, 'Consulta inválida.');
    }
    const equal = readObject(where, [], Object.keys(fields));
    const problems = instanceProblems(myContext, Object.fromEntries(Object.keys(equal).map(name => [name, fields[name]!])), equal);
    if (problems.length) throw new ApiFailure(400, 'Filtros inválidos.', problems);
    return {filter: filter.trim(), ...(sort === undefined ? {} : {sort}), direction, page: Number(page), where: equal} as EntityQuery;
}

// Counts, rows and versions come from one PostgreSQL statement/snapshot.
export async function queryEntity(pool: Pick<Pool, 'query'>, name: string, fields: Fields, pk: readonly string[], query: EntityQuery) {
    const values: unknown[] = [];
    const parameter = (value: unknown) => { values.push(value); return `$${values.length}`; };
    const names = Object.keys(fields);
    const predicates = Object.entries(query.where ?? {}).map(([field, value]) => `${quote(field)} IS NOT DISTINCT FROM ${parameter(value)}`);
    if (query.filter) {
        const search = parameter(query.filter);
        predicates.push(`(${names.map(field => `strpos(lower(${quote(field)}::text), lower(${search})) > 0`).join(' OR ')})`);
    }
    const order = [...new Set([...(query.sort ? [query.sort] : []), ...pk])].map(field => {
        return `${quote(field)}${sqlMapping[fields[field]!.type] === 'text' ? ' COLLATE "C"' : ''} ${field === query.sort ? query.direction ?? 'asc' : 'asc'} NULLS LAST`;
    }).join(', ');
    const page = parameter(query.page ?? 1);
    const result = await pool.query<{rows: Record<string, unknown>[]; versions: string[]; total: number; matched: number; page: number}>(
        `WITH stats AS (SELECT count(*)::int AS total, count(*) FILTER (WHERE ${predicates.join(' AND ') || 'TRUE'})::int AS matched FROM ${entityTable(name)}), ` +
        `position AS (SELECT total, matched, LEAST(${page}::int, GREATEST(1, ceil(matched::numeric / ${browsing.pageSize})::int)) AS page FROM stats), ` +
        `selected AS (SELECT ${names.map(quote).join(', ')}, xmin::text AS "__version" FROM ${entityTable(name)} ` +
        `WHERE (SELECT total <= ${browsing.clientRows} FROM stats) OR (${predicates.join(' AND ') || 'TRUE'}) ORDER BY ${order} ` +
        `LIMIT (SELECT CASE WHEN total <= ${browsing.clientRows} THEN ${browsing.clientRows} ELSE ${browsing.pageSize} END FROM stats) ` +
        `OFFSET (SELECT CASE WHEN total <= ${browsing.clientRows} THEN 0 ELSE (page - 1) * ${browsing.pageSize} END FROM position)) ` +
        `SELECT total, matched, page, COALESCE((SELECT json_agg(to_jsonb(selected) - '__version') FROM selected), '[]') AS rows, ` +
        `COALESCE((SELECT json_agg("__version") FROM selected), '[]') AS versions FROM position`, values);
    const data = result.rows[0]!;
    const window: EntityWindow = data.total <= browsing.clientRows ? {kind: 'complete'} : {kind: 'page', total: data.total, matched: data.matched, page: data.page};
    return {rows: data.rows, versions: data.versions, window};
}

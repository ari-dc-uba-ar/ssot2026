import type {Pool} from 'pg';
import type {EntityInfo} from 'system-definition';
import {instanceProblems} from 'system-definition';
import {sql, identifier, entityTable, joinSql, querySql} from './sql.js';
import {myContext, sqlMapping} from './system.js';
import {ApiFailure, readObject} from './api-errors.js';
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

export function queryPredicate(fields: Fields, query: EntityQuery) {
    const names = Object.keys(fields);
    const predicates = Object.entries(query.where ?? {}).map(([field, value]) => sql`${identifier(field)} IS NOT DISTINCT FROM ${value}`);
    if (query.filter) {
        predicates.push(sql`(${joinSql(names.map(field => sql`strpos(lower(${identifier(field)}::text), lower(${query.filter})) > 0`), sql` OR `)})`);
    }
    return predicates.length ? joinSql(predicates, sql` AND `) : sql`TRUE`;
}

// Counts, rows and versions come from one PostgreSQL statement/snapshot.
export async function queryEntity(pool: Pick<Pool, 'query'>, name: string, fields: Fields, pk: readonly string[], query: EntityQuery) {
    const predicate = queryPredicate(fields, query);
    const order = joinSql([...new Set([...(query.sort ? [query.sort] : []), ...pk])].map(field =>
        sql`${identifier(field)}${sqlMapping[fields[field]!.type] === 'text' ? sql` COLLATE "C"` : sql``} ${field === query.sort && query.direction === 'desc' ? sql`desc` : sql`asc`} NULLS LAST`));
    const result = await querySql<{rows: Record<string, unknown>[]; versions: string[]; total: number; matched: number; page: number}>(pool,
        sql`WITH stats AS (SELECT count(*)::int AS total, count(*) FILTER (WHERE ${predicate})::int AS matched FROM ${entityTable(name)}),
        position AS (SELECT total, matched, LEAST(${query.page ?? 1}::int, GREATEST(1, ceil(matched::numeric / ${browsing.pageSize})::int)) AS page FROM stats),
        selected AS (SELECT ${joinSql(Object.keys(fields).map(name => identifier(name)))}, xmin::text AS "__version" FROM ${entityTable(name)}
        WHERE (SELECT total <= ${browsing.clientRows} FROM stats) OR (${predicate}) ORDER BY ${order}
        LIMIT (SELECT CASE WHEN total <= ${browsing.clientRows} THEN ${browsing.clientRows}::int ELSE ${browsing.pageSize}::int END FROM stats)
        OFFSET (SELECT CASE WHEN total <= ${browsing.clientRows} THEN 0 ELSE (page - 1) * ${browsing.pageSize} END FROM position))
        SELECT total, matched, page, COALESCE((SELECT json_agg(to_jsonb(selected) - '__version') FROM selected), '[]') AS rows,
        COALESCE((SELECT json_agg("__version") FROM selected), '[]') AS versions FROM position`);
    const data = result.rows[0]!;
    const window: EntityWindow = data.total <= browsing.clientRows ? {kind: 'complete'} : {kind: 'page', total: data.total, matched: data.matched, page: data.page};
    return {rows: data.rows, versions: data.versions, window};
}

import type {Pool} from 'pg';
import type {EntityInfo} from 'system-definition';
import {myContext, sqlMapping} from './system.js';
import {inputConstraints} from './value-types.js';
import {reportSources, type ReportCatalog} from './report-joins.js';
import {ApiFailure, readObject} from './api-errors.js';
import {readQuery, queryPredicate} from './entity-query.js';
import {browsing} from './browsing.js';
import {sql, identifier, joinSql, querySql} from './sql.js';
import type {AggregateOperation, ReportDefinition, ReportMeasure, ReportResponse} from './browser-contract.js';

// SQL representations, supplied by the SSOT, determine valid operations.
const operations = {
    text: ['count', 'min', 'max'], integer: ['count', 'sum', 'avg', 'min', 'max'], boolean: ['count'],
} satisfies Record<(typeof sqlMapping)[keyof typeof sqlMapping], AggregateOperation[]>;
const labels = {count: 'Cantidad con valor', sum: 'Suma', avg: 'Promedio', min: 'Mínimo', max: 'Máximo'};
type Entity = EntityInfo<typeof myContext>;
export function reportDefinition(entity: Entity, catalog: ReportCatalog, joins: unknown = []): ReportDefinition {
    const {fields, metadata} = reportSources(entity, catalog, joins);
    return {name: entity.name, label: catalog.labels[entity.name]!, pageSize: browsing.pageSize, rowCount: {operation: 'count', label: 'Cantidad de filas del resultado'}, sources: metadata,
        columns: Object.values(fields).map(({name, label, type, nullable, writable}) => ({
            name, label, type, nullable, writable, constraints: inputConstraints[type],
            aggregates: operations[sqlMapping[type]].map(operation => ({operation, label: labels[operation]})),
        })),
    };
}

export async function runReport(db: Pick<Pool, 'query'>, entity: Entity, input: unknown, catalog: ReportCatalog): Promise<ReportResponse> {
    const {groupBy, measures, joins = [], ...filters} = readObject(input, ['groupBy', 'measures'], ['joins', 'filter', 'where', 'page']);
    const {fields, column, from, sources, metadata} = reportSources(entity, catalog, joins);
    const query = readQuery(filters, fields);
    const invalid = () => new ApiFailure(400, 'Definición de reporte inválida.');
    if (!Array.isArray(groupBy) || !groupBy.every((name): name is string => typeof name === 'string' && Object.hasOwn(fields, name)) ||
        new Set(groupBy).size !== groupBy.length || !Array.isArray(measures) || (!groupBy.length && !measures.length)) throw invalid();
    const selected: ReportMeasure[] = measures.map(value => {
        const measure = readObject(value, ['operation'], ['field', 'source']);
        if (measure['operation'] === 'countDistinct') {
            const source = measure['source'];
            if (Object.hasOwn(measure, 'field') || typeof source !== 'number' || !Number.isInteger(source) || !metadata[source]?.distinctRecords) throw invalid();
            return {operation: 'countDistinct', source};
        }
        if (Object.hasOwn(measure, 'source')) throw invalid();
        if (!Object.hasOwn(measure, 'field')) {
            if (measure['operation'] !== 'count') throw invalid();
            return {operation: 'count'};
        }
        const field = measure['field'], operation = measure['operation'];
        if (typeof field !== 'string' || !Object.hasOwn(fields, field) || typeof operation !== 'string' ||
            !(operations[sqlMapping[fields[field]!.type]] as readonly string[]).includes(operation)) throw invalid();
        return {field, operation: operation as AggregateOperation};
    });
    if (new Set(selected.map(measure => JSON.stringify(measure))).size !== selected.length) throw invalid();
    const groups = groupBy.map(column);
    const columns = [
        ...groupBy.map((name, index) => ({name: `g${index}`, label: fields[name]!.label})),
        ...selected.map((measure, index) => ({name: `m${index}`, label: measure.operation === 'countDistinct'
            ? `Registros distintos · ${metadata[measure.source]!.label}` : 'field' in measure
                ? `${labels[measure.operation]} · ${fields[measure.field]!.label}` : 'Cantidad de filas del resultado'})),
    ];
    const aggregate = {
        count: (field: ReturnType<typeof identifier>) => sql`count(${field})`,
        sum: (field: ReturnType<typeof identifier>) => sql`sum(${field})`,
        avg: (field: ReturnType<typeof identifier>) => sql`avg(${field})`,
        min: (field: ReturnType<typeof identifier>) => sql`min(${field})`,
        max: (field: ReturnType<typeof identifier>) => sql`max(${field})`,
    };
    const expression = (measure: ReportMeasure) => {
        if (measure.operation === 'countDistinct') {
            const keys = sources[measure.source]!.entity.pk.map(name => identifier(`r${measure.source}`, name));
            return sql`count(DISTINCT ROW(${joinSql(keys)})) FILTER (WHERE ${keys[0]} IS NOT NULL)`;
        }
        return 'field' in measure ? aggregate[measure.operation](column(measure.field)) : sql`count(*)`;
    };
    const selection = joinSql([
        ...groups.map((field, index) => sql`${field} AS ${identifier(`g${index}`)}`),
        ...selected.map((measure, index) => sql`${expression(measure)}::text AS ${identifier(`m${index}`)}`),
    ]);
    const ordering = groupBy.map((name, index) => sql`${identifier(`g${index}`)}${sqlMapping[fields[name]!.type] === 'text' ? sql` COLLATE "C"` : sql``} ASC NULLS LAST`);
    // Aggregates travel as text to preserve PostgreSQL numeric precision.
    const result = await querySql<Omit<ReportResponse, 'columns' | 'pageSize'>>(db, sql`
        WITH grouped AS (SELECT ${selection} FROM ${from} WHERE ${queryPredicate(fields, query, column)}
            ${groups.length ? sql`GROUP BY ${joinSql(groups)}` : sql``}),
        position AS (SELECT count(*)::int AS total,
            LEAST(${query.page ?? 1}::int, GREATEST(1, ceil(count(*)::numeric / ${browsing.pageSize})::int)) AS page FROM grouped),
        selected AS (SELECT * FROM grouped ${ordering.length ? sql`ORDER BY ${joinSql(ordering)}` : sql``}
            LIMIT ${browsing.pageSize} OFFSET (SELECT (page - 1) * ${browsing.pageSize} FROM position))
        SELECT total, page, COALESCE((SELECT json_agg(selected) FROM selected), '[]') AS rows FROM position`);
    return {...result.rows[0]!, columns, pageSize: browsing.pageSize};
}

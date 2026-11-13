import type {Pool} from 'pg';
import type {EntityInfo} from 'system-definition';
import {myContext, sqlMapping} from './system.js';
import {inputConstraints} from './value-types.js';
import {allowedFields} from './column-security.js';
import {ApiFailure, readObject} from './api-errors.js';
import {readQuery, queryPredicate} from './entity-query.js';
import {browsing} from './browsing.js';
import {sql, identifier, entityTable, joinSql, querySql} from './sql.js';
import type {AggregateOperation, ReportDefinition, ReportMeasure, ReportResponse} from './browser-contract.js';

// SQL representations, supplied by the SSOT, determine valid operations.
const operations = {
    text: ['count', 'min', 'max'], integer: ['count', 'sum', 'avg', 'min', 'max'], boolean: ['count'],
} satisfies Record<(typeof sqlMapping)[keyof typeof sqlMapping], AggregateOperation[]>;
const labels = {count: 'Cantidad con valor', sum: 'Suma', avg: 'Promedio', min: 'Mínimo', max: 'Máximo'};
type Entity = EntityInfo<typeof myContext>;
const reportFields = (entity: Entity) => Object.fromEntries(Object.entries(allowedFields(entity, 'read')).filter(([, field]) => field.visible));

export function reportDefinition(entity: Entity, label: string): ReportDefinition {
    return {name: entity.name, label, pageSize: browsing.pageSize, rowCount: {operation: 'count', label: 'Cantidad de registros'},
        columns: Object.values(reportFields(entity)).map(({name, label, type, nullable, writable}) => ({
            name, label, type, nullable, writable, constraints: inputConstraints[type],
            aggregates: operations[sqlMapping[type]].map(operation => ({operation, label: labels[operation]})),
        })),
    };
}

export async function runReport(db: Pick<Pool, 'query'>, entity: Entity, input: unknown): Promise<ReportResponse> {
    const {groupBy, measures, ...filters} = readObject(input, ['groupBy', 'measures'], ['filter', 'where', 'page']);
    const fields = reportFields(entity);
    const query = readQuery(filters, fields);
    const invalid = () => new ApiFailure(400, 'Definición de reporte inválida.');
    if (!Array.isArray(groupBy) || !groupBy.every((name): name is string => typeof name === 'string' && Object.hasOwn(fields, name)) ||
        new Set(groupBy).size !== groupBy.length || !Array.isArray(measures) || (!groupBy.length && !measures.length)) throw invalid();
    const selected: ReportMeasure[] = measures.map(value => {
        const measure = readObject(value, ['operation'], ['field']);
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
    const groups = groupBy.map(name => identifier(name));
    const columns = [
        ...groupBy.map((name, index) => ({name: `g${index}`, label: fields[name]!.label})),
        ...selected.map((measure, index) => ({name: `m${index}`, label: 'field' in measure
            ? `${labels[measure.operation]} · ${fields[measure.field]!.label}` : 'Cantidad de registros'})),
    ];
    const aggregate = {
        count: (field: ReturnType<typeof identifier>) => sql`count(${field})`,
        sum: (field: ReturnType<typeof identifier>) => sql`sum(${field})`,
        avg: (field: ReturnType<typeof identifier>) => sql`avg(${field})`,
        min: (field: ReturnType<typeof identifier>) => sql`min(${field})`,
        max: (field: ReturnType<typeof identifier>) => sql`max(${field})`,
    };
    const selection = joinSql([
        ...groups.map((field, index) => sql`${field} AS ${identifier(`g${index}`)}`),
        ...selected.map((measure, index) => sql`${'field' in measure ? aggregate[measure.operation](identifier(measure.field)) : sql`count(*)`}::text AS ${identifier(`m${index}`)}`),
    ]);
    const ordering = groupBy.map((name, index) => sql`${identifier(`g${index}`)}${sqlMapping[fields[name]!.type] === 'text' ? sql` COLLATE "C"` : sql``} ASC NULLS LAST`);
    // Aggregates travel as text to preserve PostgreSQL numeric precision.
    const result = await querySql<Omit<ReportResponse, 'columns' | 'pageSize'>>(db, sql`
        WITH grouped AS (SELECT ${selection} FROM ${entityTable(entity.name)} WHERE ${queryPredicate(fields, query)}
            ${groups.length ? sql`GROUP BY ${joinSql(groups)}` : sql``}),
        position AS (SELECT count(*)::int AS total,
            LEAST(${query.page ?? 1}::int, GREATEST(1, ceil(count(*)::numeric / ${browsing.pageSize})::int)) AS page FROM grouped),
        selected AS (SELECT * FROM grouped ${ordering.length ? sql`ORDER BY ${joinSql(ordering)}` : sql``}
            LIMIT ${browsing.pageSize} OFFSET (SELECT (page - 1) * ${browsing.pageSize} FROM position))
        SELECT total, page, COALESCE((SELECT json_agg(selected) FROM selected), '[]') AS rows FROM position`);
    return {...result.rows[0]!, columns, pageSize: browsing.pageSize};
}

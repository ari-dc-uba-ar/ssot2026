import type {EntityInfo} from 'system-definition';
import type {myContext} from './system.js';
import {entityReferences} from './entity-relations.js';
import {allowedFields} from './column-security.js';
import {ApiFailure, readObject} from './api-errors.js';
import {sql, identifier, entityTable, joinSql} from './sql.js';
import type {ReportSource} from './browser-contract.js';

type Entity = EntityInfo<typeof myContext>;
type Relationship = ReportSource['relationships'][number] & {pairs: [string, string][]};
export function createReportCatalog(entities: ReadonlyMap<string, Entity>, labels: Readonly<Record<string, string>>) {
    const relationships = new Map([...entities.keys()].map(name => [name, [] as Relationship[]]));
    for (const entity of entities.values()) for (const reference of entityReferences(entity, entities, 'read')) {
        const pairs = Object.entries(reference.fields);
        relationships.get(entity.name)!.push({id: JSON.stringify(['out', entity.name, reference.name]),
            entity: reference.entity, label: `${labels[reference.entity]} · ${reference.name}`, pairs});
        relationships.get(reference.entity)!.push({id: JSON.stringify(['in', entity.name, reference.name]),
            entity: entity.name, label: `${labels[entity.name]} · ${reference.name}`, pairs: pairs.map(([a, b]) => [b, a])});
    }
    return {entities, labels, relationships};
}
export type ReportCatalog = ReturnType<typeof createReportCatalog>;

export function reportSources(entity: Entity, catalog: ReportCatalog, joins: unknown) {
    if (!Array.isArray(joins)) throw new ApiFailure(400, 'Uniones inválidas.');
    const sources = [{entity, optional: false, label: catalog.labels[entity.name]!}];
    const fragments = [sql`${entityTable(entity.name)} AS ${identifier('r0')}`];
    for (const value of joins) {
        const join = readObject(value, ['source', 'relationship', 'kind']);
        const parent = typeof join['source'] === 'number' && Number.isInteger(join['source']) ? sources[join['source']] : undefined;
        const relationship = parent && catalog.relationships.get(parent.entity.name)!.find(edge => edge.id === join['relationship']);
        if (!parent || !relationship || (join['kind'] !== 'inner' && join['kind'] !== 'left')) throw new ApiFailure(400, 'Unión inválida. Seleccioná una relación disponible.');
        const index = sources.length;
        fragments.push(sql`${join['kind'] === 'left' ? sql`LEFT JOIN` : sql`INNER JOIN`} ${entityTable(relationship.entity)} AS ${identifier(`r${index}`)} ON
            ${joinSql(relationship.pairs.map(([source, target]) => sql`${identifier(`r${join['source']}`, source)} = ${identifier(`r${index}`, target)}`), sql` AND `)}`);
        sources.push({entity: catalog.entities.get(relationship.entity)!, optional: join['kind'] === 'left', label: `${relationship.label} (${index + 1})`});
    }
    const columns = sources.flatMap(({entity, optional, label}, index) => Object.values(allowedFields(entity, 'read'))
        .filter(field => field.visible).map(field => ({
            field: {...field, name: joins.length ? JSON.stringify([index, field.name]) : field.name,
                label: joins.length ? `${label} · ${field.label}` : field.label, nullable: optional || field.nullable},
            expression: identifier(`r${index}`, field.name),
        })));
    const metadata: ReportSource[] = sources.map(({entity, label}, index) => ({
        index, entity: entity.name, label, distinctRecords: entity.pk.every(name => !!allowedFields(entity, 'read')[name]),
        relationships: catalog.relationships.get(entity.name)!.map(({id, entity, label}) => ({id, entity, label})),
    }));
    const fields = Object.fromEntries(columns.map(({field}) => [field.name, field]));
    const expressions = new Map(columns.map(({field, expression}) => [field.name, expression]));
    return {sources, metadata, fields, from: joinSql(fragments, sql` `), column: (name: string) => expressions.get(name)!};
}

import type {EntityResponse, EntityRow, EntityQuery} from '../backend/browser-contract.js';
import type {createEntityCache} from './entity-cache.js';
import {entityPage} from './entity-query.js';
import {referenceOptions} from './foreign-keys.js';

const text = (value: unknown): string => value == null ? 'Ninguna' : value === '' ? '""' : String(value);

// Adapted from PR #41: one association page, plus exact lookups for its visible references.
export async function loadRelatedPage(relationship: EntityResponse['referencedBy'][number], row: EntityRow, page: number,
    load: ReturnType<typeof createEntityCache>['load'], options: EntityQuery = {}) {
    const where = Object.fromEntries(Object.entries(relationship.fields).map(([source, target]) => [source, row[target]!]));
    // SQL foreign keys with null components do not establish a relationship.
    if (Object.values(where).some(value => value == null)) return null;
    const query = {...options, where: {...options.where, ...where}, page};
    const entity = await load(relationship.entity, query);
    const result = entityPage(entity, query);
    const hidden = new Set(Object.keys(relationship.fields));
    const visible = entity.columns.filter(column => !hidden.has(column.name));
    const references = entity.references.filter(fk => visible.some(column => Object.hasOwn(fk.fields, column.name)));
    const resolved = await Promise.all(references.map(async fk => {
        const labels = await Promise.all(result.rows.map(async item => {
            const pairs = Object.entries(fk.fields);
            const values = pairs.map(([source]) => item[source]);
            const fallback = values.map(text).join(' / ');
            if (values.some(value => value == null)) return fallback;
            const where = Object.fromEntries(pairs.map(([source, target]) => [target, item[source]!]));
            const target = entityPage(await load(fk.entity, {where}), {where}).rows[0];
            return target ? referenceOptions(fk, [target])[0]?.label ?? fallback : fallback;
        }));
        return {fk, labels, lead: visible.find(column => Object.hasOwn(fk.fields, column.name))!.name};
    }));
    const columns = visible.flatMap(column => {
        const owners = resolved.filter(reference => reference.lead === column.name);
        if (owners.length) return owners.map(({fk, labels}) => ({label: owners.length > 1 ? `${column.label} · ${fk.name}` : column.label, values: labels}));
        if (resolved.some(({fk}) => Object.hasOwn(fk.fields, column.name))) return [];
        return [{label: column.label, values: result.rows.map(row => text(row[column.name]))}];
    });
    return {...result, columns, fields: visible, totalPages: Math.max(1, Math.ceil(result.matched / entity.browsing.pageSize))};
}

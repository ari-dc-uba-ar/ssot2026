import type {EntityName, EntityQuery, EntityResponse} from '../backend/browser-contract.js';
import type {Row} from './row-editor.js';
import {loadEntity} from './api.js';
import {element} from './dom.js';
import {entityPage} from './entity-query.js';
import {referenceOptions} from './foreign-keys.js';

type Load = (name: EntityName, query?: EntityQuery) => Promise<EntityResponse>;

// Every row of an entity that matches `where`, across pages.
async function rowsWhere(load: Load, name: EntityName, where: Row): Promise<Row[]> {
    const rows: Row[] = [];
    for (let page = 1; ; page++) {
        const query = {where, page} as EntityQuery;
        const result = entityPage(await load(name, query), query);
        rows.push(...result.rows);
        if (rows.length >= result.matched || !result.rows.length) return rows;
    }
}

const text = (value: unknown): string => value == null ? 'Ninguna' : value === '' ? '""' : String(value);

/* One table per relationship that references `row`, for its review dialog, instead of filtering each sheet.
   The key back to `row` is implied; other references show their labels, as in the sheet. */
export async function relatedRows(entity: EntityResponse, row: Row, names: readonly EntityName[], load: Load = loadEntity): Promise<HTMLElement[]> {
    const sections: HTMLElement[] = [];
    for (const name of names) {
        const related = await load(name);
        for (const reference of related.foreignKeys.filter(fk => fk.entity === entity.name)) {
            const hidden = new Set(Object.keys(reference.fields));
            const rows = await rowsWhere(load, name, Object.fromEntries(Object.entries(reference.fields).map(([source, target]) => [source, row[target]!])));
            const others = await Promise.all(related.foreignKeys.filter(fk => fk !== reference).map(async fk => ({
                fk, lead: Object.keys(fk.fields).find(field => !hidden.has(field)),
                labels: new Map(referenceOptions(fk, await rowsWhere(load, fk.entity, {})).map(option => [JSON.stringify(option.values), option.label])),
            })));
            const columns = related.columns.filter(column => !hidden.has(column.name)).flatMap(column => {
                const other = others.find(({fk}) => column.name in fk.fields);
                if (!other) return [{label: column.label, value: (item: Row) => text(item[column.name])}];
                if (other.lead !== column.name) return [];
                const key = (item: Row) => JSON.stringify(Object.fromEntries(Object.keys(other.fk.fields).map(field => [field, item[field]])));
                return [{label: column.label, value: (item: Row) => other.labels.get(key(item)) ?? text(item[column.name])}];
            });

            const section = element('section');
            section.append(element('h3', related.label));
            if (!rows.length) section.append(element('p', 'Sin registros.'));
            else {
                const table = element('table');
                const header = table.createTHead().insertRow();
                for (const column of columns) header.append(element('th', column.label));
                const body = table.createTBody();
                for (const item of rows) {
                    const tr = body.insertRow();
                    for (const column of columns) tr.insertCell().textContent = column.value(item);
                }
                section.append(table);
            }
            sections.push(section);
        }
    }
    return sections;
}

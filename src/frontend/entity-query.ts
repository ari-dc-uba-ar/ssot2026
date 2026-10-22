import type {EntityQuery, EntityResponse} from '../backend/browser-contract.js';

// PostgreSQL uses C collation for text: compare Unicode code points, not browser locale.
function compare(left: unknown, right: unknown): number {
    if (typeof left === 'number' && typeof right === 'number') return left - right;
    if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right);
    const a = Array.from(String(left), character => character.codePointAt(0)!);
    const b = Array.from(String(right), character => character.codePointAt(0)!);
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
    return a.length - b.length;
}

export function entityPage(entity: EntityResponse, query: EntityQuery = {}) {
    if (entity.window.kind === 'page') return {...entity.window, rows: entity.rows, versions: entity.versions};
    const filter = (query.filter ?? '').trim().toLowerCase();
    const rows = entity.rows.map((row, index) => ({row, version: entity.versions[index]!}))
        .filter(({row}) => Object.entries(query.where ?? {}).every(([key, value]) => Reflect.get(row, key) === value) &&
            (!filter || Object.values(row).some(value => value != null && String(value).toLowerCase().includes(filter))));
    const fields = [...new Set([...(query.sort ? [query.sort] : []), ...entity.pk])];
    rows.sort((a, b) => {
        for (const field of fields) {
            const left: unknown = Reflect.get(a.row, field), right: unknown = Reflect.get(b.row, field);
            const comparison = left == null ? (right == null ? 0 : 1) : right == null ? -1 :
                compare(left, right) * (field === query.sort && query.direction === 'desc' ? -1 : 1);
            if (comparison) return comparison;
        }
        return 0;
    });
    const page = Math.min(query.page ?? 1, Math.max(1, Math.ceil(rows.length / entity.browsing.pageSize)));
    const selected = rows.slice((page - 1) * entity.browsing.pageSize, page * entity.browsing.pageSize);
    return {rows: selected.map(item => item.row), versions: selected.map(item => item.version), page, matched: rows.length, total: entity.rows.length};
}

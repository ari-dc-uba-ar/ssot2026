import type {EntityForeignKey} from '../backend/api-contract.js';

type Value = string | number | boolean | null;
type Row = Readonly<Record<string, Value>>;

export function referenceOptions(reference: EntityForeignKey, rows: readonly Row[]) {
    return rows.filter(row => Object.values(reference.fields).every(name => row[name] != null)).map(row => ({
        label: reference.displayFields.map(name => row[name]).filter(value => value != null && value !== '').join(' — '),
        values: Object.fromEntries(Object.entries(reference.fields).map(([source, target]) => [source, row[target]!])),
    }));
}

type Value = string | number | boolean | null;
type Row = Readonly<Record<string, Value>>;
type Reference = {fields: Readonly<Record<string, string>>; displayFields: readonly string[]};
export type ReferenceSource = {reference: Reference; rows: readonly Row[]};

export function referenceOptions(reference: Reference, rows: readonly Row[]) {
    const keys = [...new Set(Object.values(reference.fields))];
    const descriptions = reference.displayFields.filter(name => !keys.includes(name));
    return rows.filter(row => Object.values(reference.fields).every(name => row[name] != null)).map(row => ({
        label: [...keys.map(name => row[name] === '' ? '""' : String(row[name])),
            ...descriptions.map(name => row[name]).filter(value => value != null && value !== '')].join(' — '),
        values: Object.fromEntries(Object.entries(reference.fields).map(([source, target]) => [source, row[target]!])),
    }));
}

export function createReferenceFields(sources: readonly ReferenceSource[], initial: Row = {}) {
    const relations = sources.map(source => ({...source, names: Object.keys(source.reference.fields),
        rows: source.rows.filter(row => Object.values(source.reference.fields).every(name => row[name] != null))}));
    const names = [...new Set(relations.flatMap(source => source.names))];
    // Columns that always occur together form one local key, such as (month, year).
    const grouped = new Map<string, string[]>();
    for (const name of names) {
        const signature = JSON.stringify(relations.flatMap((source, index) => source.names.includes(name) ? [index] : []));
        if (!grouped.has(signature)) grouped.set(signature, []);
        grouped.get(signature)!.push(name);
    }
    const groups = [...grouped.values()].map(fields => ({name: fields[0]!, fields,
        width: Math.min(...relations.filter(source => source.names.includes(fields[0]!)).map(source => source.names.length))}));
    const byField = new Map(groups.flatMap(group => group.fields.map(field => [field, group] as const)));
    type Group = (typeof groups)[number];
    type Relation = (typeof relations)[number];
    type Choice = {value: Exclude<Value, null>; values: Record<string, Value>; label: string; key: string};
    type Selection = {values: Readonly<Record<string, Value>>; key: string | null};
    const members = (source: Relation) => groups.filter(group => source.names.includes(group.name));
    const owner = (source: Relation) => members(source).toSorted((left, right) => left.width - right.width).at(-1)!;
    const authorities = (group: Group) => relations.filter(source => source.names.includes(group.name) && source.names.length === group.width);
    const connected = (group: Group) => {
        const component = new Set([group]);
        for (let previous = 0; previous !== component.size;) {
            previous = component.size;
            for (const source of relations) {
                const shared = members(source);
                if (shared.some(group => component.has(group))) shared.forEach(group => component.add(group));
            }
        }
        return component;
    };
    const empty = (group: Group): Selection => ({values: Object.fromEntries(group.fields.map(field => [field, null])), key: null});
    const selected: Record<string, Selection> = Object.fromEntries(groups.map(group => [group.name,
        {values: Object.fromEntries(group.fields.map(field => [field, initial[field] ?? null])), key: null}]));
    const complete = (group: Group, selection: Selection | undefined) => group.fields.every(field => selection?.values[field] != null);
    const tuple = (source: Relation, row: Row, group: Group) => group.fields.map(field => row[source.reference.fields[field]!]!);
    const choice = (source: Relation, row: Row, group: Group): Choice => {
        const values = tuple(source, row, group);
        const keyFields = Object.values(source.reference.fields);
        const descriptions = owner(source) === group ? source.reference.displayFields.filter(field => !keyFields.includes(field)) : [];
        const labels = descriptions.map(field => row[field]).filter(value => value != null && value !== '');
        const code = values.map(value => value === '' ? '""' : String(value)).join(' / ');
        return {value: values[0]!, values: Object.fromEntries(group.fields.map((field, index) => [field, values[index]!])),
            label: [code, ...labels].join(' — '), key: JSON.stringify([values, labels])};
    };
    const optionsFor = (group: Group, selections: Readonly<Record<string, Selection>>): Choice[] => {
        const component = connected(group);
        const primary = authorities(group);
        const active = relations.filter(source => component.has(byField.get(source.names[0]!)!) && (primary.includes(source)
            || owner(source) === group || complete(owner(source), selections[owner(source).name])
            || (!members(source).some(member => member.width === source.names.length)
                && members(source).some(member => member !== group && complete(member, selections[member.name])))));
        const filtered = active.map(source => ({source, rows: source.rows.filter(row => members(source).every(other => {
            const selection = selections[other.name];
            if (other === group || !complete(other, selection)) return true;
            if (other.fields.some(field => row[source.reference.fields[field]!] !== selection!.values[field])) return false;
            return !selection!.key || !authorities(other).includes(source) || choice(source, row, other).key === selection!.key;
        }))}));
        // Compare complete key tuples while propagating selections through shared FK columns.
        for (let changed = true; changed;) {
            changed = false;
            for (const other of component) {
                const sharing = filtered.filter(entry => entry.source.names.includes(other.name));
                if (sharing.length < 2) continue;
                const allowed = sharing.map(entry => new Set(entry.rows.map(row => JSON.stringify(tuple(entry.source, row, other)))));
                for (const entry of sharing) {
                    const rows = entry.rows.filter(row => allowed.every(values => values.has(JSON.stringify(tuple(entry.source, row, other)))));
                    if (rows.length !== entry.rows.length) { entry.rows = rows; changed = true; }
                }
            }
        }
        const source = primary[0]!;
        const choices = new Map<string, Choice>();
        for (const row of filtered.find(entry => entry.source === source)!.rows) {
            const option = choice(source, row, group);
            choices.set(option.key, option);
        }
        return [...choices.values()];
    };
    const options = (name: string) => optionsFor(byField.get(name)!, selected);
    const selection = (name: string): string | null => {
        const group = byField.get(name)!;
        const current = selected[group.name]!;
        if (current.key || !complete(group, current)) return current.key;
        const matching = options(name).filter(option => group.fields.every(field => option.values[field] === current.values[field]));
        return matching.length === 1 ? matching[0]!.key : null;
    };
    for (const group of groups) selected[group.name]!.key = selection(group.name);
    return {names, groups, group: (name: string) => byField.get(name), has: (name: string) => byField.has(name),
        value: (name: string): Value => selected[byField.get(name)!.name]!.values[name]!, selection, options,
        change(name: string, next: Value, key?: string): void {
            const group = byField.get(name);
            if (!group) throw new Error('La referencia seleccionada no está disponible.');
            const primary = authorities(group)[0]!;
            const all = primary.rows.map(row => choice(primary, row, group));
            const matching = key ? all.filter(option => option.key === key && option.values[name] === next)
                : options(name).filter(option => option.values[name] === next);
            const candidates = key || matching.length ? matching : all.filter(option => option.values[name] === next);
            const distinct = new Map(candidates.map(option => [option.key, option]));
            if (next !== null && distinct.size !== 1) throw new Error('Elegí una combinación de código y nombre disponible.');
            selected[group.name] = next === null ? empty(group) : {values: [...distinct.values()][0]!.values, key: [...distinct.keys()][0]!};
            const accepted: Record<string, Selection> = {[group.name]: selected[group.name]!};
            const component = connected(group);
            for (const other of groups.filter(other => other !== group && component.has(other)).sort((left, right) => left.width - right.width)) {
                const current = selected[other.name]!;
                const compatible = !complete(other, current) || optionsFor(other, accepted).some(option =>
                    other.fields.every(field => option.values[field] === current.values[field]) && (!current.key || option.key === current.key));
                selected[other.name] = compatible ? current : empty(other);
                accepted[other.name] = selected[other.name]!;
            }
        },
    };
}

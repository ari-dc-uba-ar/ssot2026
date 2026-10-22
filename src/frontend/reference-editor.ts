import type {EntityResponse} from '../backend/browser-contract.js';
import type {LoadedReferenceSource} from './reference-sources.js';
import {referenceOptions} from './foreign-keys.js';
import {entityPage} from './entity-query.js';
import {element} from './dom.js';
import type {Value} from './row-editor.js';

// Large references use the same query/cache as tables, without treating a page as a complete relation.
export function createReferenceEditors(entity: EntityResponse, sources: readonly LoadedReferenceSource[], initial: Readonly<Record<string, Value>>, active: boolean) {
    const values = {...initial};
    const references = sources.map(source => source.reference);
    const controls = references.map(reference => {
        const source = sources.find(item => item.reference === reference)!;
        const names = Object.keys(reference.fields);
        const label = names.map(name => entity.inputs.find(column => column.name === name)!.label).join(' / ');
        const field = element('div');
        field.className = 'field';
        const input = element('select');
        input.setAttribute('aria-label', label);
        input.required = names.some(name => !entity.inputs.find(column => column.name === name)!.nullable);
        const search = element('input');
        search.placeholder = `Buscar ${label}…`;
        search.setAttribute('aria-label', search.placeholder);
        const previous = element('button', '◀'), next = element('button', '▶');
        previous.type = next.type = 'button';
        previous.setAttribute('aria-label', `Opciones anteriores de ${label}`);
        next.setAttribute('aria-label', `Opciones siguientes de ${label}`);
        const count = element('span'), error = element('span');
        error.className = 'field-error';
        field.append(element('label', label), search, input, previous, count, next, error);
        let page = 1, revision = 0;
        let options: ReturnType<typeof referenceOptions> = [];
        const refresh = async () => {
            const current = ++revision;
            const where = Object.fromEntries(Object.entries(reference.fields).filter(([name]) => values[name] != null &&
                references.some(other => other !== reference && Object.hasOwn(other.fields, name)))
                .map(([name, target]) => [target, values[name]!]));
            try {
                const query = {filter: search.value, page, where};
                const result = entityPage(await source.load(query), query);
                if (current !== revision) return;
                page = result.page;
                options = referenceOptions(reference, result.rows);
                input.replaceChildren(new Option(input.required ? 'Seleccionar…' : 'Ninguna', ''));
                options.forEach((option, index) => input.add(new Option(option.label, String(index))));
                const selected = options.findIndex(option => names.every(name => option.values[name] === values[name]));
                input.value = selected < 0 ? '' : String(selected);
                if (selected < 0 && names.every(name => values[name] != null)) {
                    input.add(new Option(names.map(name => String(values[name])).join(' / '), 'current'));
                    input.value = 'current';
                }
                previous.disabled = page <= 1;
                next.disabled = page * source.target.browsing.pageSize >= result.matched;
                count.textContent = ` ${page} / ${Math.max(1, Math.ceil(result.matched / source.target.browsing.pageSize))} `;
                error.textContent = '';
            } catch (failure) { if (current === revision) error.textContent = failure instanceof Error ? failure.message : 'No se pudieron cargar las opciones.'; }
        };
        search.oninput = event => { event.stopPropagation(); page = 1; void refresh(); };
        search.onchange = event => event.stopPropagation();
        previous.onclick = () => { page--; void refresh(); };
        next.onclick = () => { page++; void refresh(); };
        input.onchange = () => {
            const selected = input.value === '' ? {} : options[Number(input.value)]!.values;
            const changed = names.filter(name => values[name] !== (selected[name] ?? null));
            for (const other of references) {
                if (other !== reference && changed.some(name => Object.hasOwn(other.fields, name))) {
                    for (const name of Object.keys(other.fields)) if (!names.includes(name)) values[name] = null;
                }
            }
            for (const name of names) values[name] = selected[name] ?? null;
            for (const control of controls) void control.refresh();
        };
        return {label, field, names, error, refresh, read: () => names.map(name => [name, values[name] ?? null] as const)};
    });
    if (active) for (const control of controls) void control.refresh();
    return controls;
}

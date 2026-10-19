import type {EntityInputColumn, EntityName, EntityResponse, EntityRow} from '../backend/api-contract.js';
import type {Problem} from 'system-definition';
import {createReferenceFields} from './foreign-keys.js';
import type {LoadedReferenceSource} from './reference-sources.js';
import {createReferenceEditors} from './reference-editor.js';
import {element} from './dom.js';
import {messageOf} from './messages.js';

type Column = EntityInputColumn<EntityName>;
export type Row = EntityRow<EntityName>;
export type Value = {[E in EntityName]: EntityRow<E>[keyof EntityRow<E>]}[EntityName];
type FieldReader = {label: string; field: HTMLElement; names: string[]; error: HTMLElement; read: () => (readonly [string, Value])[]};
type Editor = {input: HTMLInputElement | HTMLSelectElement; read: () => Value; requiredWhenEnabled?: boolean};

function integerEditor(constraints: Column['constraints']): Editor {
    const input = element('input');
    input.type = 'number';
    input.step = '1';
    if (constraints.minimum !== undefined) input.min = String(constraints.minimum);
    return {input, read: () => input.valueAsNumber, requiredWhenEnabled: true};
}

function enumEditor(constraints: Column['constraints']): Editor {
    const input = element('select');
    input.add(new Option('Seleccionar…', ''));
    for (const value of constraints.options ?? []) input.add(new Option(value, value));
    return {input, read: () => input.value, requiredWhenEnabled: true};
}

// Each supported display type has one editor. Adding a backend type requires a renderer.
const editors = {
    text: (_constraints) => {
        const input = element('input');
        return {input, read: () => input.value};
    },
    password: constraints => {
        const input = element('input');
        input.type = 'password';
        input.autocomplete = 'new-password';
        input.minLength = constraints.minLength ?? 0;
        input.maxLength = constraints.maxLength ?? 524288;
        return {input, read: () => input.value};
    },
    integer: integerEditor,
    posInteger: integerEditor,
    regularidad: enumEditor,
    cuatrimestre: enumEditor,
    boolean: (_constraints) => {
        const input = element('select');
        input.add(new Option('No', 'false'));
        input.add(new Option('Sí', 'true'));
        return {input, read: () => input.value === 'true'};
    },
} satisfies Record<Column['type'], (constraints: Column['constraints']) => Editor>;

// The existing metadata-driven editor, shared by spreadsheet insertion and editing.
export function createRowEditor(entity: EntityResponse, sources: readonly LoadedReferenceSource[], row?: Row, active = true) {
    const id = crypto.randomUUID();
    const values: Readonly<Record<string, Value>> = row ?? {};
    const remote = sources.some(source => source.target.window.kind === 'page');
    const remoteReaders = remote ? createReferenceEditors(entity, sources, values, active) : [];
    const references = createReferenceFields(remote ? [] : sources, values);
    const controls = new Map<string, {input: HTMLSelectElement; columns: Column[]}>();
    const refreshReferences = () => {
        for (const [name, {input, columns}] of controls) {
            const options = references.options(name);
            const empty = new Option(columns.every(column => column.nullable) ? 'Ninguna' : 'Seleccionar…', '');
            input.replaceChildren(empty);
            input.title = options.length ? '' : 'No hay opciones compatibles con la selección actual.';
            options.forEach((option, index) => input.add(new Option(option.label, String(index + 1))));
            const selectedKey = references.selection(name);
            const selected = options.findIndex(option => option.key === selectedKey);
            input.value = selected < 0 ? '' : String(selected + 1);
            const unavailable = selected < 0 && references.group(name)!.fields.some(field => references.value(field) !== null);
            input.setCustomValidity(unavailable ? 'Seleccioná una referencia disponible.' : '');
            if (unavailable) {
                const option = new Option('Referencia no disponible', 'unavailable');
                option.disabled = true;
                input.add(option);
                input.value = option.value;
            }
        }
    };
    const rendered = new Set<string>();
    const renderedRemote = new Set<FieldReader>();
    const readers = entity.inputs.flatMap<FieldReader>(column => {
        const remoteReader = remoteReaders.find(reader => reader.names.includes(column.name));
        if (remoteReader) {
            const related = remoteReaders.filter(reader => reader.names.includes(column.name) && !renderedRemote.has(reader));
            related.forEach(reader => renderedRemote.add(reader));
            return related;
        }
        const group = references.group(column.name);
        if (group) {
            if (rendered.has(group.name)) return [];
            rendered.add(group.name);
            const columns = group.fields.map(name => entity.inputs.find(input => input.name === name)!);
            const input = element('select');
            input.id = `field-${id}-${group.name}`;
            input.name = group.name;
            input.required = !columns.every(column => column.nullable);
            controls.set(group.name, {input, columns});
            input.onchange = () => {
                const option = input.value === '' ? null : references.options(group.name)[Number(input.value) - 1]!;
                references.change(group.name, option?.value ?? null, option?.key);
                refreshReferences();
            };
            const label = element('label', columns.map(column => column.label).join(' / '));
            label.htmlFor = input.id;
            const field = element('div');
            field.className = 'field';
            const error = element('span');
            error.className = 'field-error';
            field.append(label, input, error);
            return [{label: label.textContent!, field, names: group.fields, error, read: () => group.fields.map(name => [name, references.value(name)] as const)}];
        }
        const editor: Editor = editors[column.type](column.constraints);
        editor.input.id = `field-${id}-${column.name}`;
        editor.input.name = column.name;
        editor.input.value = String(values[column.name] ?? (column.type === 'boolean' ? false : ''));
        const optional = !!row && column.optionalOnUpdate;
        if (optional && editor.input instanceof HTMLInputElement) editor.input.placeholder = 'Sin cambios';
        editor.input.required = (!column.nullable || !!editor.requiredWhenEnabled) && !optional;
        const label = element('label', column.label);
        if (optional) label.append(document.createTextNode(' (opcional)'));
        label.htmlFor = editor.input.id;
        const field = element('div');
        field.className = 'field';
        field.append(label, editor.input);
        const empty = element('input');
        empty.type = 'checkbox';
        empty.checked = column.nullable && values[column.name] == null;
        if (column.nullable) {
            const nullLabel = element('label');
            nullLabel.className = 'null-option';
            nullLabel.append(empty, document.createTextNode(' Ninguna'));
            field.append(nullLabel);
            empty.onchange = () => { editor.input.disabled = empty.checked; };
        }
        editor.input.disabled = empty.checked;
        const error = element('span');
        error.className = 'field-error';
        field.append(error);
        return [{label: label.textContent!, field, names: [column.name], error, read: () => {
            const value = empty.checked ? null : editor.read();
            return optional && value === '' ? [] : [[column.name, value] as const];
        }}];
    });
    refreshReferences();

    const seen = new Set<FieldReader>();
    const cells = entity.columns.flatMap(column => {
        const reader = readers.find(candidate => candidate.names.includes(column.name));
        if (reader) {
            if (seen.has(reader)) return [];
            seen.add(reader);
            return [{name: reader.names[0]!, label: reader.label, field: reader.field}];
        }
        return [{name: column.name, label: column.label, field: element('span', String(values[column.name] ?? ''))}];
    });
    for (const reader of readers) {
        if (!seen.has(reader)) cells.push({name: reader.names[0]!, label: reader.label, field: reader.field});
    }
    let dirty = false;
    for (const reader of readers) {
        reader.field.addEventListener('input', () => { dirty = true; });
        reader.field.addEventListener('change', () => { dirty = true; });
    }
    return {
        dirty: () => dirty,
        saved: () => { dirty = false; },
        cells,
        read: () => Object.fromEntries(readers.flatMap(reader => reader.read())),
        valid: () => readers.every(reader => [...reader.field.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')]
            .every(input => input.disabled || input.reportValidity())),
        problems: (problems: readonly Problem[]) => {
            for (const reader of readers) {
                reader.error.textContent = problems.filter(problem => problem.field !== null && reader.names.includes(problem.field))
                    .map(messageOf).join('; ');
                reader.field.classList.toggle('has-error', !!reader.error.textContent);
            }
        },
    };
}
export type RowEditor = ReturnType<typeof createRowEditor>;

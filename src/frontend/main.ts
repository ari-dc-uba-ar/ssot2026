import type {EntityInputColumn, EntityCreate, EntityKey, EntityName, EntityResponse, EntityRow, EntityUpdate} from '../backend/api-contract.js';
import {ApiRequestError, createRow, deleteRow, isAuthenticated, listEntities, loadEntity, updateRow} from './api.js';
import {messageOf} from './messages.js';
import {initializeAuthentication} from './auth-ui.js';
import {createReferenceFields} from './foreign-keys.js';
import {loadReferenceSources} from './reference-sources.js';

type Column = EntityInputColumn<EntityName>;
type Row = EntityRow<EntityName>;
type Value = {[E in EntityName]: EntityRow<E>[keyof EntityRow<E>]}[EntityName];
type FieldReader = {field: HTMLElement; names: string[]; error: HTMLElement; read: () => (readonly [string, Value])[]};

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
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
    integer: (_constraints) => {
        const input = element('input');
        input.type = 'number';
        input.step = '1';
        input.required = true;
        return {input, read: () => input.valueAsNumber};
    },
    boolean: (_constraints) => {
        const input = element('select');
        input.add(new Option('No', 'false'));
        input.add(new Option('Sí', 'true'));
        return {input, read: () => input.value === 'true'};
    },
} satisfies Record<Column['type'], (constraints: Column['constraints']) => {input: HTMLInputElement | HTMLSelectElement; read: () => Value}>;

const workspace = document.querySelector<HTMLFieldSetElement>('#workspace')!;
const selector = document.querySelector<HTMLSelectElement>('#entity')!;
const content = document.querySelector<HTMLElement>('#content')!;
const status = document.querySelector<HTMLElement>('#status')!;
const dialog = document.querySelector<HTMLDialogElement>('#editor')!;
const form = document.querySelector<HTMLFormElement>('#form')!;
const fields = document.querySelector<HTMLFieldSetElement>('#fields')!;
const editorStatus = document.querySelector<HTMLElement>('#editor-status')!;

async function run(work: () => Promise<void>): Promise<void> {
    workspace.disabled = fields.disabled = true;
    status.textContent = 'Cargando…';
    editorStatus.textContent = '';
    try {
        await work();
        status.textContent = '';
    } catch (error) {
        status.textContent = editorStatus.textContent = error instanceof Error ? error.message : 'No se pudo completar la operación.';
    } finally {
        workspace.disabled = !isAuthenticated();
        fields.disabled = false;
    }
}

function button(label: string, action: () => void): HTMLButtonElement {
    const node = element('button', label);
    node.type = 'button';
    node.onclick = action;
    return node;
}

function rowKey(entity: EntityResponse, row: Row): EntityKey<EntityName> {
    const values: Readonly<Record<string, Value>> = row;
    // The API supplies the key names; reflection loses their literal types.
    return Object.fromEntries(entity.pk.map(name => [name, values[name]])) as EntityKey<EntityName>;
}

async function edit(entity: EntityResponse, row?: Row): Promise<void> {
    const values: Readonly<Record<string, Value>> = row ?? {};
    const sources = await loadReferenceSources(entity.foreignKeys);
    if (!isAuthenticated()) return;
    const references = createReferenceFields(sources, values);
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
    const readers = entity.inputs.flatMap<FieldReader>(column => {
        const group = references.group(column.name);
        if (group) {
            if (rendered.has(group.name)) return [];
            rendered.add(group.name);
            const columns = group.fields.map(name => entity.inputs.find(input => input.name === name)!);
            const input = element('select');
            input.id = `field-${group.name}`;
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
            return [{field, names: group.fields, error, read: () => group.fields.map(name => [name, references.value(name)] as const)}];
        }
        const editor = editors[column.type](column.constraints);
        editor.input.id = `field-${column.name}`;
        editor.input.name = column.name;
        editor.input.value = String(values[column.name] ?? (column.type === 'boolean' ? false : ''));
        const optional = !!row && column.optionalOnUpdate;
        editor.input.required = !column.nullable && !optional;
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
        return [{field, names: [column.name], error, read: () => {
            const value = empty.checked ? null : editor.read();
            return optional && value === '' ? [] : [[column.name, value] as const];
        }}];
    });
    refreshReferences();
    fields.replaceChildren(...readers.map(reader => reader.field));
    const actions = element('div');
    actions.className = 'actions';
    const save = element('button', 'Guardar');
    save.type = 'submit';
    actions.append(save, button('Cancelar', () => dialog.close()));
    fields.append(actions);
    document.querySelector('#editor-title')!.textContent = `${row ? 'Editar' : 'Crear'} · ${entity.name}`;
    editorStatus.textContent = '';
    form.onsubmit = event => {
        event.preventDefault();
        // Editors follow the API's type/nullability metadata; the backend validates the row again.
        const next = Object.fromEntries(readers.flatMap(reader => reader.read())) as Record<string, Value>;
        void run(async () => {
            try {
                if (row) await updateRow(entity.name, {key: rowKey(entity, row), row: next} as EntityUpdate<EntityName>);
                else await createRow(entity.name, next as EntityCreate<EntityName>);
            } catch (error) {
                // The backend reports structured problems; show each one next to its field.
                if (!(error instanceof ApiRequestError) || !error.problems.length) throw error;
                for (const reader of readers) reader.error.textContent = '';
                for (const problem of error.problems) {
                    const reader = readers.find(candidate => problem.field !== null && candidate.names.includes(problem.field));
                    if (reader) reader.error.textContent = messageOf(problem);
                    else editorStatus.textContent = [editorStatus.textContent, messageOf(problem)].filter(Boolean).join('; ');
                }
                return;
            }
            dialog.close();
            form.reset();
            await show(entity.name);
        });
    };
    dialog.showModal();
}

async function show(name: EntityName): Promise<void> {
    content.replaceChildren();
    const entity = await loadEntity(name);
    const toolbar = element('div');
    toolbar.className = 'toolbar';
    toolbar.append(element('h2', entity.name), element('span', `${entity.rows.length} registros`),
        button('Actualizar', () => { void run(() => show(name)); }),
        button('Crear registro', () => { void run(() => edit(entity)); }));
    const table = element('table');
    const header = table.createTHead().insertRow();
    for (const column of entity.columns) header.append(element('th', column.label));
    header.append(element('th', 'Acciones'));
    const body = table.createTBody();
    for (const row of entity.rows) {
        const values: Readonly<Record<string, Value>> = row;
        const tr = body.insertRow();
        for (const column of entity.columns) {
            const value = values[column.name];
            const cell = tr.insertCell();
            cell.textContent = value == null ? 'Ninguna' : typeof value === 'boolean' ? (value ? 'Sí' : 'No') : String(value);
            if (value == null) cell.className = 'muted';
        }
        const actions = tr.insertCell();
        actions.className = 'actions';
        actions.append(button('Editar', () => { void run(() => edit(entity, row)); }), button('Eliminar', () => {
            const key = rowKey(entity, row);
            if (confirm(`¿Eliminar ${entity.name}: ${Object.values(key).join(' · ')}?`)) {
                void run(async () => {
                    await deleteRow(entity.name, key);
                    await show(name);
                });
            }
        }));
    }
    const scroll = element('div');
    scroll.className = 'table-scroll';
    scroll.append(table);
    content.replaceChildren(toolbar, scroll);
    if (!entity.rows.length) content.append(element('p', 'No hay registros. Creá el primero para comenzar.'));
}

initializeAuthentication(active => {
    workspace.hidden = !active;
    if (!active) {
        dialog.close();
        form.reset();
        content.replaceChildren();
        selector.replaceChildren();
        return;
    }
    void run(async () => {
        const names = await listEntities();
        selector.replaceChildren(...names.map(name => new Option(name, name)));
        selector.onchange = () => {
            const name = names[selector.selectedIndex];
            if (name) void run(() => show(name));
        };
        if (names[0]) await show(names[0]);
        else content.textContent = 'No hay entidades disponibles.';
    });
});

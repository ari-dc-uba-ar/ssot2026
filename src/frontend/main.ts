import type {EntityColumn, EntityKey, EntityName, EntityResponse, EntityRow, EntityUpdate} from '../backend/api-contract.js';
import {createRow, deleteRow, listEntities, loadEntity, updateRow} from './api.js';

type Column = EntityColumn<EntityName>;
type Row = EntityRow<EntityName>;
type Value = {[E in EntityName]: EntityRow<E>[keyof EntityRow<E>]}[EntityName];

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
}

// Each supported display type has one editor. Adding a backend type requires a renderer.
const editors = {
    text: () => {
        const input = element('input');
        return {input, read: () => input.value};
    },
    integer: () => {
        const input = element('input');
        input.type = 'number';
        input.step = '1';
        input.required = true;
        return {input, read: () => input.valueAsNumber};
    },
    boolean: () => {
        const input = element('select');
        input.add(new Option('No', 'false'));
        input.add(new Option('Sí', 'true'));
        return {input, read: () => input.value === 'true'};
    },
} satisfies Record<Column['type'], () => {input: HTMLInputElement | HTMLSelectElement; read: () => Value}>;

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
        workspace.disabled = fields.disabled = false;
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

function edit(entity: EntityResponse, row?: Row): void {
    const values: Readonly<Record<string, Value>> = row ?? {};
    const readers = entity.columns.map(column => {
        const editor = editors[column.type]();
        editor.input.id = `field-${column.name}`;
        editor.input.name = column.name;
        editor.input.value = String(values[column.name] ?? (column.type === 'boolean' ? false : ''));
        const label = element('label', column.label);
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
            nullLabel.append(empty, document.createTextNode(' Sin valor'));
            field.append(nullLabel);
            empty.onchange = () => { editor.input.disabled = empty.checked; };
        }
        editor.input.disabled = empty.checked;
        return {field, name: column.name, read: () => empty.checked ? null : editor.read()};
    });
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
        const next = Object.fromEntries(readers.map(reader => [reader.name, reader.read()])) as Row;
        void run(async () => {
            if (row) await updateRow(entity.name, {key: rowKey(entity, row), row: next} as EntityUpdate<EntityName>);
            else await createRow(entity.name, next);
            dialog.close();
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
        button('Crear registro', () => edit(entity)));
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
            cell.textContent = value == null ? 'Sin valor' : typeof value === 'boolean' ? (value ? 'Sí' : 'No') : String(value);
            if (value == null) cell.className = 'muted';
        }
        const actions = tr.insertCell();
        actions.className = 'actions';
        actions.append(button('Editar', () => edit(entity, row)), button('Eliminar', () => {
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

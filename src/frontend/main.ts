import type {DeleteDependencyCheck, EntityColumn, EntityCreate, EntityInputColumn, EntityKey, EntityName, EntityResponse, EntityRow, EntityUpdate} from '../backend/api-contract.js';
import {ApiRequestError, checkDeleteDependencies, createRow, deleteRow, deleteRows, isAuthenticated, listEntities, loadEntity, updateRow} from './api.js';
import {messageOf} from './messages.js';
import {initializeAuthentication} from './auth-ui.js';
import {createReferenceFields} from './foreign-keys.js';
import {loadReferenceSources} from './reference-sources.js';
import {confirmAction, showDeleteDependencies} from './confirm.js';

type Column = EntityColumn<EntityName>;
type InputColumn = EntityInputColumn<EntityName>;
type Row = EntityRow<EntityName>;
type Value = {[E in EntityName]: EntityRow<E>[keyof EntityRow<E>]}[EntityName];
type Editor = {input: HTMLInputElement | HTMLSelectElement; read: () => Value; requiredWhenEnabled?: boolean};
type ReferenceEditor = Editor & {fields: readonly string[]; commit: () => void};

const labels: Readonly<Record<string, string>> = {
    materias: 'Materias',
    pabellones: 'Pabellones',
    planes: 'Planes de Estudio',
    usuarios: 'Usuarios',
    departamentos: 'Departamentos',
    estudiantes: 'Estudiantes',
    enrolamientos: 'Inscripciones',
};

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
}

function integerEditor(constraints: InputColumn['constraints']): Editor {
    const input = element('input');
    input.type = 'number';
    input.step = '1';
    if (constraints.minimum !== undefined) input.min = String(constraints.minimum);
    return {input, read: () => input.valueAsNumber};
}

function enumEditor(constraints: InputColumn['constraints']): Editor {
    const input = element('select');
    input.add(new Option('Seleccionar…', ''));
    for (const value of constraints.options ?? []) input.add(new Option(value, value));
    return {input, read: () => input.value, requiredWhenEnabled: true};
}

// Each supported display type has one editor. Adding a backend type requires a renderer.
const editors = {
    text: (_constraints: InputColumn['constraints']) => {
        const input = element('input');
        return {input, read: () => input.value};
    },
    integer: integerEditor,
    posInteger: integerEditor,
    regularidad: enumEditor,
    cuatrimestre: enumEditor,
    boolean: (_constraints: InputColumn['constraints']) => {
        const input = element('select');
        input.add(new Option('No', 'false'));
        input.add(new Option('Sí', 'true'));
        return {input, read: () => input.value === 'true'};
    },
} satisfies Record<Column['type'], (constraints: InputColumn['constraints']) => Editor>;

const workspace = document.querySelector<HTMLFieldSetElement>('#workspace')!;
const tabs = document.querySelector<HTMLElement>('#tabs')!;
const content = document.querySelector<HTMLElement>('#content')!;
const status = document.querySelector<HTMLElement>('#status')!;

const cache: Record<string, EntityResponse> = {};
let allEntities: EntityName[] = [];
let currentEntity: EntityName | null = null;

async function run(work: () => Promise<void>): Promise<void> {
    workspace.disabled = true;
    status.className = '';
    status.textContent = 'Cargando…';
    try {
        await work();
        if (status.textContent === 'Cargando…') status.textContent = '';
    } catch (error) {
        status.className = 'error';
        status.textContent = error instanceof Error ? error.message : 'No se pudo completar la operación.';
    } finally {
        workspace.disabled = !isAuthenticated();
    }
}

function button(label: string, action: () => void, className = ''): HTMLButtonElement {
    const node = element('button', label);
    node.type = 'button';
    if (className) node.className = className;
    node.onclick = action;
    return node;
}

function rowKey(entity: EntityResponse, row: Row): EntityKey<EntityName> {
    const values: Readonly<Record<string, Value>> = row;
    return Object.fromEntries(entity.pk.map(name => [name, values[name]])) as EntityKey<EntityName>;
}

async function load(name: EntityName): Promise<EntityResponse> {
    if (!cache[name]) cache[name] = await loadEntity(name);
    return cache[name]!;
}

function editorFor(column: Column, constraints: InputColumn['constraints'] = {minLength: null, maxLength: null}): Editor {
    const ed = editors[column.type](constraints);
    if (column.nullable && column.type === 'boolean') {
        (ed.input as HTMLSelectElement).prepend(new Option('(sin valor)', ''));
    }
    if (column.writable === false) ed.input.disabled = true;
    return {
        input: ed.input,
        read: () => column.nullable && ed.input.value === '' ? null : ed.read(),
    };
}

function referenceEditors(entity: EntityResponse, initial: Row, sources: Awaited<ReturnType<typeof loadReferenceSources>>): Map<string, ReferenceEditor> {
    const references = createReferenceFields(sources, initial);
    const controls = new Map<string, HTMLSelectElement>();
    const result = new Map<string, ReferenceEditor>();
    for (const group of references.groups) {
        for (const name of group.fields) {
            const input = element('select');
            const column = entity.columns.find(one => one.name === name);
            input.required = !group.fields.every(field => entity.columns.find(one => one.name === field)?.nullable);
            input.disabled = column?.writable === false;
            const commit = () => {
                const options = references.options(name);
                const option = input.value === '' ? undefined : options[Number(input.value) - 1];
                references.change(name, option?.values[name] ?? null, option?.key);
                refresh();
            };
            input.onchange = commit;
            controls.set(name, input);
            result.set(name, {input, fields: group.fields, read: () => references.value(name), commit});
        }
    }
    function refresh(): void {
        for (const [name, input] of controls) {
            const column = entity.columns.find(one => one.name === name);
            const options = references.options(name);
            const selection = references.selection(name);
            input.replaceChildren(new Option(column?.nullable ? '(sin valor)' : 'Seleccionar…', ''));
            options.forEach((option, index) => input.add(new Option(option.label, String(index + 1))));
            const selected = options.findIndex(option => option.key === selection);
            input.setCustomValidity('');
            if (selected >= 0) {
                input.value = String(selected + 1);
            } else if (references.value(name) !== null) {
                const unavailable = new Option('Referencia no disponible', 'unavailable');
                unavailable.disabled = true;
                input.add(unavailable);
                input.value = unavailable.value;
                input.setCustomValidity('Seleccioná una referencia disponible.');
            } else {
                input.value = '';
            }
        }
    }
    refresh();
    return result;
}

function filterAndSort(rows: Row[], filter: string, sortCol: string, sortAsc: boolean): Row[] {
    const result = filter
        ? rows.filter(r => Object.values(r).some(v => v != null && String(v).toLowerCase().includes(filter)))
        : [...rows];

    if (sortCol) {
        result.sort((a, b) => {
            const va = a[sortCol as keyof Row], vb = b[sortCol as keyof Row];
            if (va == null) return 1;
            if (vb == null) return -1;
            const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
            return sortAsc ? cmp : -cmp;
        });
    }
    return result;
}

async function onCellChange(entity: EntityResponse, row: Row, col: Column, td: HTMLTableCellElement, next: Value, related?: Readonly<Record<string, Value>>): Promise<void> {
    const updated = {...row, ...related, [col.name]: next} as Row;
    td.classList.remove('has-error');
    status.className = '';
    status.textContent = 'Guardando…';
    try {
        await updateRow(entity.name, {key: rowKey(entity, row), row: updated} as EntityUpdate<EntityName>);
        Object.assign(row, updated);
        status.textContent = 'Guardado';
        setTimeout(() => { if (status.textContent === 'Guardado') status.textContent = ''; }, 1500);
    } catch (error) {
        td.classList.add('has-error');
        status.className = 'error';
        const msg = error instanceof ApiRequestError && error.problems.length
            ? error.problems.map(messageOf).join('; ')
            : (error instanceof Error ? error.message : 'Error al guardar');
        status.textContent = `Error en ${col.label}: ${msg}`;
    }
}


async function onDeleteRow(entity: EntityResponse, row: Row): Promise<void> {
    const desc = Object.values(rowKey(entity, row)).join(' · ');
    const name = labels[entity.name] ?? entity.name;
    const confirmed = await confirmAction({
        title: `Eliminar de ${name}`,
        message: `¿Eliminar permanentemente "${desc}"? Esta acción no se puede deshacer.`,
        confirmText: 'Eliminar fila',
        danger: true,
    });
    if (!confirmed) return;
    await run(async () => {
        await deleteRow(entity.name, rowKey(entity, row));
        delete cache[entity.name];
        await show(entity.name);
    });
}

async function onSaveNewRow(entity: EntityResponse, fields: {col: Column; ed: ReturnType<typeof editorFor>; td: HTMLTableCellElement}[]): Promise<void> {
    if (entity.name === 'usuarios') return;
    fields.forEach(f => f.td.classList.remove('has-error'));
    const next = Object.fromEntries(fields.map(f => [f.col.name, f.ed.read()])) as Row;
    await run(async () => {
        try {
            await createRow(entity.name, next as EntityCreate<typeof entity.name>);
            delete cache[entity.name];
            await show(entity.name);
            status.textContent = 'Fila agregada correctamente.';
        } catch (error) {
            if (!(error instanceof ApiRequestError) || !error.problems.length) throw error;
            for (const p of error.problems) {
                const target = fields.find(f => f.col.name === p.field);
                if (target) target.td.classList.add('has-error');
            }
            status.className = 'error';
            status.textContent = error.problems.map(messageOf).join('; ');
        }
    });
}

async function selectTab(name: EntityName): Promise<void> {
    currentEntity = name;
    allEntities.forEach((ent, i) => {
        const tab = tabs.children[i] as HTMLButtonElement | undefined;
        if (tab) {
            tab.classList.toggle('active', ent === name);
            tab.setAttribute('aria-selected', String(ent === name));
        }
    });
    await show(name);
}

async function show(name: EntityName): Promise<void> {
    const entity = await load(name);
    const title = labels[entity.name] ?? entity.name;
    const unit = title.toLowerCase();

    const sources = await loadReferenceSources(entity.foreignKeys);

    let filter = '';
    let sortCol = '';
    let sortAsc = true;
    let page = 1;
    let adding = false;
    const selectedRows = new Set<Row>();
    let selectionCheck = 0;
    const pageSize = 10;

    const toolbar = element('div');
    toolbar.className = 'toolbar';
    const count = element('span');
    const filterInput = element('input');
    filterInput.className = 'filter-input';
    filterInput.placeholder = `Filtrar ${unit}…`;
    filterInput.oninput = () => { filter = filterInput.value.toLowerCase().trim(); page = 1; render(); };

    const selectionStatus = element('span');
    selectionStatus.setAttribute('role', 'status');
    selectionStatus.setAttribute('aria-live', 'polite');
    const deleteSelectedButton = button('Borrar todos los seleccionados', () => void onDeleteSelected(), 'danger');
    deleteSelectedButton.disabled = true;
    toolbar.append(element('h2', title), count, filterInput, deleteSelectedButton, selectionStatus);
    if (entity.name === 'usuarios') {
        toolbar.append(button('+ Agregar usuario', openCreateUserModal, 'primary'));
    } else {
        toolbar.append(button('+ Agregar fila', () => { adding = true; render(); }, 'primary'));
    }

    const table = element('table');
    const headerRow = table.createTHead().insertRow();
    const idxTh = element('th', '#');
    idxTh.className = 'row-idx';
    const selectVisible = element('input');
    selectVisible.type = 'checkbox';
    selectVisible.setAttribute('aria-label', 'Seleccionar todas las filas visibles');
    const selectTh = element('th');
    selectTh.className = 'selection-col';
    selectTh.append(selectVisible);
    headerRow.append(selectTh);
    headerRow.append(idxTh);

    for (const col of entity.columns) {
        const th = element('th', col.label);
        th.onclick = () => {
            if (sortCol === col.name) sortAsc = !sortAsc;
            else { sortCol = col.name; sortAsc = true; }
            render();
        };
        headerRow.append(th);
    }
    headerRow.append(element('th', 'Acciones'));
    selectVisible.onchange = () => {
        const rows = filterAndSort(entity.rows, filter, sortCol, sortAsc);
        const start = (page - 1) * pageSize;
        for (const row of rows.slice(start, start + pageSize)) {
            if (selectVisible.checked) selectedRows.add(row);
            else selectedRows.delete(row);
        }
        render();
        void refreshDeleteSelection();
    };

    async function refreshDeleteSelection(): Promise<void> {
        const check = ++selectionCheck;
        const rows = [...selectedRows];
        deleteSelectedButton.disabled = true;
        deleteSelectedButton.textContent = `Borrar todos los seleccionados (${rows.length})`;
        if (!rows.length) {
            selectionStatus.textContent = '';
            return;
        }
        if (rows.length > 500) {  //La idea es que si a futuro meten muchas filas no explote el back
            selectionStatus.textContent = 'El máximo por operación es 500 filas.';
            return;
        }
        selectionStatus.textContent = 'Comprobando dependencias…';
        try {
            const result: DeleteDependencyCheck = await checkDeleteDependencies(entity.name, rows.map(row => rowKey(entity, row)));
            if (check !== selectionCheck) return;
            if (result.blockers.length) {
                selectionStatus.textContent = `Bloqueado: ${result.blockers.map(({entity: dependent, relationship, count: dependentCount}) =>
                    `${labels[dependent] ?? dependent} (${relationship}): ${dependentCount}`).join('; ')}.`;
                deleteSelectedButton.disabled = false;
                return;
            }
            selectionStatus.textContent = `${rows.length} fila${rows.length === 1 ? '' : 's'} lista${rows.length === 1 ? '' : 's'} para borrar.`;
            deleteSelectedButton.disabled = false;
        } catch (error) {
            if (check !== selectionCheck) return;
            selectionStatus.textContent = error instanceof Error ? error.message : 'No se pudieron comprobar las dependencias.';
        }
    }

    async function onDeleteSelected(): Promise<void> {
        const rows = [...selectedRows];
        if (!rows.length || deleteSelectedButton.disabled) return;
        deleteSelectedButton.disabled = true;
        let reloaded = false;
        try {
            const {blockers} = await checkDeleteDependencies(entity.name, rows.map(row => rowKey(entity, row)));
            if (blockers.length) {
                await showDeleteDependencies(blockers, labels);
                deleteSelectedButton.disabled = false;
                return;
            }
        } catch (error) {
            selectionStatus.textContent = error instanceof Error ? error.message : 'No se pudieron comprobar las dependencias.';
            deleteSelectedButton.disabled = false;
            return;
        }
        const confirmed = await confirmAction({
            title: `Eliminar de ${title}`,
            message: `¿Eliminar permanentemente las ${rows.length} filas seleccionadas? Esta acción no se puede deshacer.`,
            confirmText: `Eliminar ${rows.length} filas`,
            danger: true,
        });
        if (!confirmed) {
            deleteSelectedButton.disabled = false;
            return;
        }
        await run(async () => {
            await deleteRows(entity.name, rows.map(row => rowKey(entity, row)));
            selectedRows.clear();
            delete cache[entity.name];
            await show(entity.name);
            status.textContent = `Se eliminaron ${rows.length} filas.`;
            reloaded = true;
        });
        if (!reloaded) deleteSelectedButton.disabled = false;
    }

    const tbody = table.createTBody();
    const pagination = element('div');
    pagination.className = 'pagination';
    const pageSpan = element('span');
    const prevBtn = button('◀ Anterior', () => { if (page > 1) { page--; render(); } });
    const nextBtn = button('Siguiente ▶', () => { page++; render(); });
    pagination.append(prevBtn, pageSpan, nextBtn);

    const scroll = element('div');
    scroll.className = 'table-scroll';
    scroll.append(table);

    function render(): void {
        entity.columns.forEach((col, idx) => {
            headerRow.cells[idx + 2]!.textContent = col.label + (sortCol === col.name ? (sortAsc ? ' ▲' : ' ▼') : '');
        });

        const rows = filterAndSort(entity.rows, filter, sortCol, sortAsc);
        const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
        if (page > totalPages) page = totalPages;
        const start = (page - 1) * pageSize;
        const paged = rows.slice(start, start + pageSize);

        count.textContent = filter ? `${rows.length} de ${entity.rows.length} ${unit}` : `${entity.rows.length} ${unit}`;
        pageSpan.textContent = `Página ${page} de ${totalPages}`;
        prevBtn.disabled = page <= 1;
        nextBtn.disabled = page >= totalPages;
        selectVisible.disabled = paged.length === 0;
        selectVisible.checked = paged.length > 0 && paged.every(row => selectedRows.has(row));
        selectVisible.indeterminate = paged.some(row => selectedRows.has(row)) && !selectVisible.checked;
        deleteSelectedButton.textContent = `Borrar todos los seleccionados (${selectedRows.size})`;

        tbody.replaceChildren();

        if (adding) {
            const tr = tbody.insertRow();
            tr.className = 'new-row';
            const selection = tr.insertCell();
            selection.className = 'selection-col';
            const num = tr.insertCell();
            num.className = 'row-idx';
            num.textContent = '+';

            const references = referenceEditors(entity, {} as Row, sources);
            const fields = entity.columns.filter(col => col.writable !== false).map(col => {
                const ed = references.get(col.name) ?? editorFor(col, entity.inputs.find(input => input.name === col.name)?.constraints);
                const td = tr.insertCell();
                td.append(ed.input);
                return {col, ed, td};
            });

            const actions = tr.insertCell();
            actions.className = 'actions';
            actions.append(
                button('Guardar', () => void onSaveNewRow(entity, fields), 'primary'),
                button('Cancelar', () => {
                    const dirty = fields.some(f => f.ed.read() != null && f.ed.read() !== '');
                    if (!dirty) {
                        adding = false;
                        render();
                        return;
                    }
                    void confirmAction({
                        title: 'Descartar nueva fila',
                        message: '¿Descartar los datos ingresados para la nueva fila? Los cambios no guardados se perderán.',
                        confirmText: 'Descartar',
                        danger: true,
                    }).then(ok => {
                        if (ok) {
                            adding = false;
                            render();
                        }
                    });
                })
            );
        }

        paged.forEach((row, i) => {
            const tr = tbody.insertRow();
            const selected = tr.insertCell();
            selected.className = 'selection-col';
            const checkbox = element('input');
            checkbox.type = 'checkbox';
            checkbox.checked = selectedRows.has(row);
            checkbox.setAttribute('aria-label', `Seleccionar fila ${Object.values(rowKey(entity, row)).join(' · ')}`);
            checkbox.onchange = () => {
                if (checkbox.checked) selectedRows.add(row);
                else selectedRows.delete(row);
                render();
                void refreshDeleteSelection();
            };
            selected.append(checkbox);

            const num = tr.insertCell();
            num.className = 'row-idx';
            num.textContent = String(start + i + 1);

            const references = referenceEditors(entity, row, sources);
            for (const col of entity.columns) {
                const td = tr.insertCell();
                const linked = references.get(col.name);
                const ed = linked ?? editorFor(col, entity.inputs.find(input => input.name === col.name)?.constraints);
                const val = (row as Record<string, Value>)[col.name];
                if (linked === undefined) ed.input.value = val == null ? '' : String(val);
                let prev = ed.read();
                ed.input.onchange = () => {
                    linked?.commit();
                    const next = ed.read();
                    const related = linked === undefined ? undefined : Object.fromEntries(linked.fields.map(name =>
                        [name, references.get(name)!.read()]));
                    const rowValues: Readonly<Record<string, Value>> = row;
                    const changed = linked === undefined ? next !== prev
                        : linked.fields.some(name => related?.[name] !== rowValues[name]);
                    if (changed) {
                        prev = next;
                        void onCellChange(entity, row, col, td, next, related);
                    }
                };
                td.append(ed.input);
            }

            const actions = tr.insertCell();
            actions.className = 'actions';
            actions.append(button('Eliminar', () => void onDeleteRow(entity, row), 'danger'));
        });
    }

    render();
    content.replaceChildren(toolbar, scroll, pagination);
    if (!entity.rows.length && !adding) {
        const emptyMsg = entity.name === 'usuarios'
            ? 'No hay usuarios registrados.'
            : `No hay ${unit} registradas. Agregá la primera para comenzar.`;
        content.append(element('p', emptyMsg));
    }
}

function openCreateUserModal(): void {
    const dialog = document.querySelector<HTMLDialogElement>('#create-user-dialog')!;
    const form = document.querySelector<HTMLFormElement>('#create-user-form')!;
    const userStatus = document.querySelector<HTMLElement>('#create-user-status')!;
    form.reset();
    userStatus.className = '';
    userStatus.textContent = '';
    dialog.showModal();
}

function initializeCreateUserModal(): void {
    const dialog = document.querySelector<HTMLDialogElement>('#create-user-dialog')!;
    const form = document.querySelector<HTMLFormElement>('#create-user-form')!;
    const userStatus = document.querySelector<HTMLElement>('#create-user-status')!;
    const closeBtn = document.querySelector<HTMLButtonElement>('#close-create-user')!;
    const cancelBtn = document.querySelector<HTMLButtonElement>('#cancel-create-user')!;

    const close = () => {
        dialog.close();
        form.reset();
        userStatus.className = '';
        userStatus.textContent = '';
    };

    closeBtn.onclick = close;
    cancelBtn.onclick = close;

    form.onsubmit = event => {
        event.preventDefault();
        const data = new FormData(form);
        const usuario = String(data.get('usuario') ?? '').trim();
        const contrasena = String(data.get('contrasena') ?? '');

        const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
        submitBtn.disabled = true;
        userStatus.className = '';
        userStatus.textContent = 'Creando usuario…';

        void run(async () => {
            try {
                await createRow('usuarios', {usuario, contrasena});
                close();
                delete cache['usuarios'];
                if (currentEntity === 'usuarios') await show('usuarios');
                status.className = '';
                status.textContent = `Usuario "${usuario}" creado correctamente.`;
                setTimeout(() => { if (status.textContent.includes('creado')) status.textContent = ''; }, 3000);
            } catch (error) {
                userStatus.className = 'error';
                const msg = error instanceof ApiRequestError && error.problems.length
                    ? error.problems.map(messageOf).join('; ')
                    : (error instanceof Error ? error.message : 'Error al crear usuario.');
                userStatus.textContent = msg;
            } finally {
                submitBtn.disabled = false;
            }
        });
    };
}

initializeCreateUserModal();

initializeAuthentication(active => {
    workspace.hidden = !active;
    if (!active) {
        content.replaceChildren();
        tabs.replaceChildren();
        return;
    }
    void run(async () => {
        allEntities = await listEntities();
        tabs.replaceChildren(...allEntities.map(name => {
            const tab = element('button', labels[name] ?? name);
            tab.type = 'button';
            tab.className = 'tab';
            tab.setAttribute('role', 'tab');
            tab.onclick = () => { if (currentEntity !== name) void run(() => selectTab(name)); };
            return tab;
        }));
        if (allEntities[0]) await selectTab(allEntities[0]);
        else content.textContent = 'No hay planillas disponibles.';
    });
});

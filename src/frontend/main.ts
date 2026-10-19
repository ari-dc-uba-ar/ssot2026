import type {EntityCreate, EntityKey, EntityName, EntityResponse, EntityUpdate, DeleteDependencyCheck} from '../backend/api-contract.js';
import {ApiRequestError, checkDeleteDependencies, createRow, deleteRow, deleteRows, isAuthenticated, listEntities, loadEntity, updateRow} from './api.js';
import {initializeAuthentication} from './auth-ui.js';
import {loadReferenceSources} from './reference-sources.js';
import {confirmAction, showDeleteDependencies} from './confirm.js';
import {createRowEditor, type RowEditor, type Row, type Value} from './row-editor.js';

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

function filterAndSort(rows: Row[], filter: string, sortCol: string, sortAsc: boolean): Row[] {
    const result = filter
        ? rows.filter(r => Object.values(r).some(v => v != null && String(v).toLowerCase().includes(filter)))
        : [...rows];

    if (sortCol) {
        result.sort((a, b) => {
            const va = a[sortCol as keyof Row], vb = b[sortCol as keyof Row];
            if (va == null) return vb == null ? 0 : 1;
            if (vb == null) return -1;
            const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
            return sortAsc ? cmp : -cmp;
        });
    }
    return result;
}

async function saveRow(entity: EntityResponse, editor: RowEditor, refresh: () => Promise<void>, row?: Row): Promise<void> {
    editor.problems([]);
    if (!editor.valid()) return;
    await run(async () => {
        try {
            const input = editor.read();
            if (row) await updateRow(entity.name, {key: rowKey(entity, row), row: input} as EntityUpdate<EntityName>);
            else await createRow(entity.name, input as EntityCreate<EntityName>);
        } catch (error) {
            if (error instanceof ApiRequestError) editor.problems(error.problems);
            throw error;
        }
        await refresh();
        status.textContent = row ? 'Guardado' : 'Fila agregada correctamente.';
    });
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
    let entity = await load(name);
    const title = labels[entity.name] ?? entity.name;
    const unit = title.toLowerCase();

    let sources = await loadReferenceSources(entity.foreignKeys);
    if (!isAuthenticated()) return;
    const columns = createRowEditor(entity, sources).cells;

    let filter = '';
    let sortCol = '';
    let sortAsc = true;
    let page = 1;
    let adding: RowEditor | undefined;
    const editors = new Map<Row, RowEditor>();
    const selectedRows = new Set<Row>();
    let selectionCheck = 0;
    const pageSize = 10;

    const toolbar = element('div');
    toolbar.className = 'toolbar';
    const count = element('span');
    const filterInput = element('input');
    filterInput.className = 'filter-input';
    filterInput.placeholder = `Filtrar ${unit}…`;
    filterInput.setAttribute('aria-label', filterInput.placeholder);
    filterInput.oninput = () => { filter = filterInput.value.toLowerCase().trim(); page = 1; render(); };

    const selectionStatus = element('span');
    selectionStatus.setAttribute('role', 'status');
    selectionStatus.setAttribute('aria-live', 'polite');
    const deleteSelectedButton = button('Borrar todos los seleccionados', () => void onDeleteSelected(), 'danger');
    deleteSelectedButton.disabled = true;
    toolbar.append(element('h2', title), count, filterInput, deleteSelectedButton, selectionStatus);
    toolbar.append(button('Actualizar', () => { void run(refresh); }));
    toolbar.append(button('+ Agregar fila', () => { adding ??= createRowEditor(entity, sources); render(); }, 'primary'));

    async function refresh(): Promise<void> {
        delete cache[name];
        entity = await load(name);
        sources = await loadReferenceSources(entity.foreignKeys);
        if (!isAuthenticated()) return;
        adding = undefined;
        editors.clear();
        selectedRows.clear();
        render();
        await refreshDeleteSelection();
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

    for (const col of columns) {
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
        if (rows.length > 500) {
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
        columns.forEach((col, idx) => {
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

            const editor = adding;
            for (const cell of editor.cells) tr.insertCell().append(cell.field);

            const actions = tr.insertCell();
            actions.className = 'actions';
            actions.append(
                button('Guardar', () => void saveRow(entity, editor, refresh), 'primary'),
                button('Cancelar', () => {
                    void confirmAction({
                        title: 'Descartar nueva fila',
                        message: '¿Descartar los datos ingresados para la nueva fila? Los cambios no guardados se perderán.',
                        confirmText: 'Descartar',
                        danger: true,
                    }).then(ok => {
                        if (ok) {
                            adding = undefined;
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

            if (!editors.has(row)) {
                const editor = createRowEditor(entity, sources, row);
                for (const cell of editor.cells) cell.field.addEventListener('change', () => {
                    void saveRow(entity, editor, refresh, row);
                });
                editors.set(row, editor);
            }
            for (const cell of editors.get(row)!.cells) tr.insertCell().append(cell.field);

            const actions = tr.insertCell();
            actions.className = 'actions';
            actions.append(button('Eliminar', () => void onDeleteRow(entity, row), 'danger'));
        });
    }

    render();
    content.replaceChildren(toolbar, scroll, pagination);
    if (!entity.rows.length && !adding) {
        content.append(element('p', 'No hay filas. Agregá la primera para comenzar.'));
    }
}

initializeAuthentication(active => {
    workspace.hidden = !active;
    if (!active) {
        for (const name of Object.keys(cache)) delete cache[name];
        currentEntity = null;
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

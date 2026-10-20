import type {EntityCreate, EntityKey, EntityName, EntityResponse, EntityUpdate, DeleteDependencyCheck, EntityQuery} from '../backend/api-contract.js';
import {ApiRequestError, checkDeleteDependencies, createRow, deleteRow, deleteRows, isAuthenticated, listEntities, loadStudentSummary, updateRow, watchEntities} from './api.js';
import {createEntityCache} from './entity-cache.js';
import {entityPage} from './entity-query.js';
import {element} from './dom.js';
import {reviewRow} from './review-row.js';
import {showStudentSummary} from './student-summary.js';
import {initializeAuthentication} from './auth-ui.js';
import {loadReferenceSources, type LoadedReferenceSource} from './reference-sources.js';
import {confirmAction, showDeleteDependencies} from './confirm.js';
import {createRowEditor, type RowEditor, type Row, type Value} from './row-editor.js';

let labels: Readonly<Record<string, string>> = {};

const workspace = document.querySelector<HTMLFieldSetElement>('#workspace')!;
const tabs = document.querySelector<HTMLElement>('#tabs')!;
const content = document.querySelector<HTMLElement>('#content')!;
const status = document.querySelector<HTMLElement>('#status')!;

const cache = createEntityCache();
const load = cache.load;
let stopWatching = () => {};
let invalidateView: (name: EntityName | null) => void = () => {};
let resumeLive = () => {};
let canLeaveView = async () => true;
let viewGeneration = 0;
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
        if (error instanceof DOMException && error.name === 'AbortError') return;
        status.className = 'error';
        status.textContent = error instanceof Error ? error.message : 'No se pudo completar la operación.';
    } finally {
        workspace.disabled = !isAuthenticated();
        resumeLive();
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

async function saveRow(entity: EntityResponse, editor: RowEditor, refresh: () => Promise<void>, previous?: {row: Row; version: string}): Promise<void> {
    editor.problems([]);
    if (!editor.valid()) return;
    await run(async () => {
        try {
            const input = editor.read();
            if (previous) await updateRow(entity.name, {key: rowKey(entity, previous.row), row: input,
                version: previous.version} as EntityUpdate<EntityName>);
            else await createRow(entity.name, input as EntityCreate<EntityName>);
        } catch (error) {
            if (error instanceof ApiRequestError) editor.problems(error.problems);
            throw error;
        }
        editor.saved();
        cache.invalidate(entity.name);
        await refresh();
        status.textContent = previous ? 'Guardado' : 'Fila agregada correctamente.';
    });
}

async function onDeleteRow(entity: EntityResponse, row: Row): Promise<void> {
    if (!await canLeaveView()) return;
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
        cache.invalidate(entity.name);
        await show(entity.name);
    });
}

async function selectTab(name: EntityName): Promise<void> {
    if (!await canLeaveView()) return;
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
    const generation = ++viewGeneration;
    invalidateView = () => {};
    resumeLive = () => {};
    let entity: EntityResponse;
    let sources: LoadedReferenceSource[];
    for (;;) {
        try {
            entity = await load(name);
            sources = await loadReferenceSources(entity.foreignKeys, load);
            break;
        } catch (error) {
            // A live change can invalidate a request while a tab is opening.
            if (!(error instanceof DOMException && error.name === 'AbortError') || !isAuthenticated() || generation !== viewGeneration) throw error;
        }
    }
    const title = entity.label;
    const unit = title.toLowerCase();

    if (!isAuthenticated() || generation !== viewGeneration) return;
    let columns = createRowEditor(entity, sources, undefined, false).cells;

    let filter = '';
    let sortCol = '';
    let sortAsc = true;
    let page = 1;
    let adding: RowEditor | undefined;
    const editors = new Map<Row, RowEditor>();
    const selectedRows = new Map<string, Row>();
    const selectionKey = (row: Row) => JSON.stringify(rowKey(entity, row));
    let selectionCheck = 0;
    const pageSize = entity.browsing.pageSize;
    const query = (): EntityQuery => ({filter, ...(sortCol ? {sort: sortCol} : {}), direction: sortAsc ? 'asc' : 'desc', page}) as EntityQuery;
    const dirty = () => !!adding || [...editors.values()].some(editor => editor.dirty());
    canLeaveView = async () => !dirty() || confirmAction({title: 'Descartar borrador',
        message: 'Cambiar de vista descartará los cambios sin guardar. ¿Continuar?', confirmText: 'Descartar', danger: true});
    let queryRevision = 0;
    const changeQuery = async (nextQuery: EntityQuery) => {
        if (!await canLeaveView()) { filterInput.value = filter; return; }
        filter = nextQuery.filter ?? '';
        sortCol = nextQuery.sort ?? '';
        sortAsc = nextQuery.direction !== 'desc';
        page = nextQuery.page ?? 1;
        adding = undefined;
        editors.clear();
        const revision = ++queryRevision;
        table.inert = true;
        try {
            const next = await load(name, query());
            if (revision !== queryRevision || generation !== viewGeneration) return;
            entity = next;
            render();
        } catch (error) {
            if (!(error instanceof DOMException && error.name === 'AbortError')) status.textContent = error instanceof Error ? error.message : 'No se pudo cargar la página.';
        } finally { if (revision === queryRevision) table.inert = false; }
    };

    const toolbar = element('div');
    toolbar.className = 'toolbar';
    const count = element('span');
    const filterInput = element('input');
    filterInput.className = 'filter-input';
    filterInput.placeholder = `Filtrar ${unit}…`;
    filterInput.setAttribute('aria-label', filterInput.placeholder);
    filterInput.oninput = () => { void changeQuery({...query(), filter: filterInput.value.trim(), page: 1}); };

    const selectionStatus = element('span');
    selectionStatus.setAttribute('role', 'status');
    selectionStatus.setAttribute('aria-live', 'polite');
    const deleteSelectedButton = button('Borrar todos los seleccionados', () => void onDeleteSelected(), 'danger');
    deleteSelectedButton.disabled = true;
    toolbar.append(element('h2', title), count, filterInput, deleteSelectedButton, selectionStatus);
    toolbar.append(button('Actualizar', () => { void run(async () => {
        if (dirty() && !await confirmAction({title: 'Descartar borrador', message: 'Actualizar descartará los cambios sin guardar. ¿Continuar?', confirmText: 'Descartar y actualizar', danger: true})) return;
        await refresh();
    }); }));
    toolbar.append(button('+ Agregar fila', () => { adding ??= createRowEditor(entity, sources); render(); }, 'primary'));

    async function refresh(): Promise<void> {
        const revision = ++queryRevision;
        try {
            cache.invalidate(name);
            const next = await load(name, query());
            const nextSources = await loadReferenceSources(next.foreignKeys, load);
            if (!isAuthenticated() || generation !== viewGeneration || revision !== queryRevision) return;
            entity = next;
            sources = nextSources;
            columns = createRowEditor(entity, sources, undefined, false).cells;
            adding = undefined;
            editors.clear();
            selectedRows.clear();
            render();
            await refreshDeleteSelection();
        } finally { if (revision === queryRevision) table.inert = false; }
    }

    const afterSave = async (editor: RowEditor) => {
        if (adding === editor) adding = undefined;
        if (!dirty()) await refresh();
    };

    let pendingRefresh = false;
    resumeLive = () => {
        if (!pendingRefresh || dirty() || workspace.disabled || generation !== viewGeneration) return;
        pendingRefresh = false;
        void run(refresh);
    };
    invalidateView = changed => {
        if (changed !== null && changed !== name && !sources.some(source => source.reference.entity === changed)) return;
        pendingRefresh = true;
        if (dirty() || workspace.disabled) {
            status.textContent = 'Hay datos nuevos. Tu borrador se conserva; podés revisarlos antes de actualizar.';
            return;
        }
        resumeLive();
    };

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

    function renderHeaders(): void {
        headerRow.replaceChildren(selectTh, idxTh);
        for (const col of columns) {
            const th = element('th', col.label);
            if (entity.columns.some(column => column.name === col.name)) th.onclick = () => {
                void changeQuery({...query(), sort: col.name, direction: sortCol === col.name && sortAsc ? 'desc' : 'asc', page: 1} as EntityQuery);
            };
            headerRow.append(th);
        }
        headerRow.append(element('th', 'Acciones'));
    }
    selectVisible.onchange = () => {
        for (const row of entityPage(entity, query()).rows) {
            if (selectVisible.checked) selectedRows.set(selectionKey(row), row);
            else selectedRows.delete(selectionKey(row));
        }
        render();
        void refreshDeleteSelection();
    };

    async function refreshDeleteSelection(): Promise<void> {
        const check = ++selectionCheck;
        const rows = [...selectedRows.values()];
        deleteSelectedButton.disabled = true;
        deleteSelectedButton.textContent = `Borrar todos los seleccionados (${rows.length})`;
        if (!rows.length) {
            selectionStatus.textContent = '';
            return;
        }
        if (rows.length > entity.browsing.bulkDeleteLimit) {
            selectionStatus.textContent = `El máximo por operación es ${entity.browsing.bulkDeleteLimit} filas.`;
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
        if (!await canLeaveView()) return;
        const rows = [...selectedRows.values()];
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
            cache.invalidate(entity.name);
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
    const prevBtn = button('◀ Anterior', () => { if (page > 1) void changeQuery({...query(), page: page - 1}); });
    const nextBtn = button('Siguiente ▶', () => { void changeQuery({...query(), page: page + 1}); });
    pagination.append(prevBtn, pageSpan, nextBtn);

    const scroll = element('div');
    scroll.className = 'table-scroll';
    scroll.append(table);

    function render(): void {
        renderHeaders();
        columns.forEach((col, idx) => {
            headerRow.cells[idx + 2]!.textContent = col.label + (sortCol === col.name ? (sortAsc ? ' ▲' : ' ▼') : '');
        });

        const result = entityPage(entity, query());
        const totalPages = Math.max(1, Math.ceil(result.matched / pageSize));
        page = result.page;
        const start = (page - 1) * pageSize;
        const paged = result.rows;

        count.textContent = filter ? `${result.matched} de ${result.total} ${unit}` : `${result.total} ${unit}`;
        pageSpan.textContent = `Página ${page} de ${totalPages}`;
        prevBtn.disabled = page <= 1;
        nextBtn.disabled = page >= totalPages;
        selectVisible.disabled = paged.length === 0;
        selectVisible.checked = paged.length > 0 && paged.every(row => selectedRows.has(selectionKey(row)));
        selectVisible.indeterminate = paged.some(row => selectedRows.has(selectionKey(row))) && !selectVisible.checked;
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
                button('Guardar', () => void saveRow(entity, editor, () => afterSave(editor)), 'primary'),
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
            checkbox.checked = selectedRows.has(selectionKey(row));
            checkbox.setAttribute('aria-label', `Seleccionar fila ${Object.values(rowKey(entity, row)).join(' · ')}`);
            checkbox.onchange = () => {
                if (checkbox.checked) selectedRows.set(selectionKey(row), row);
                else selectedRows.delete(selectionKey(row));
                render();
                void refreshDeleteSelection();
            };
            selected.append(checkbox);

            const num = tr.insertCell();
            num.className = 'row-idx';
            num.textContent = String(start + i + 1);

            if (!editors.has(row)) {
                const editor = createRowEditor(entity, sources, row);
                const version = entity.versions[entity.rows.findIndex(candidate => candidate === row)]!;
                for (const cell of editor.cells) cell.field.addEventListener('change', () => {
                    void saveRow(entity, editor, () => afterSave(editor), {row, version});
                });
                editors.set(row, editor);
            }
            for (const cell of editors.get(row)!.cells) tr.insertCell().append(cell.field);

            const actions = tr.insertCell();
            actions.className = 'actions';
            actions.append(button('Ver datos actuales', () => void run(async () => {
                cache.invalidate(name);
                const query = {where: rowKey(entity, row)} as EntityQuery;
                const current = entityPage(await load(name, query), query).rows[0];
                reviewRow(entity, row, editors.get(row)!.read(), current);
            })));
            if (entity.name === 'estudiantes') actions.append(button('Ver resumen', () => void run(async () => {
                showStudentSummary(await loadStudentSummary(String(Reflect.get(row, 'legajo'))));
            })));
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
        stopWatching();
        cache.clear();
        viewGeneration++;
        invalidateView = () => {};
        resumeLive = () => {};
        canLeaveView = async () => true;
        currentEntity = null;
        content.replaceChildren();
        tabs.replaceChildren();
        return;
    }
    void run(async () => {
        const catalog = await listEntities();
        if (!isAuthenticated()) return;
        allEntities = catalog.map(entity => entity.name);
        labels = Object.fromEntries(catalog.map(entity => [entity.name, entity.label]));
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
        stopWatching = watchEntities(name => { cache.invalidate(name); invalidateView(name); });
    });
});

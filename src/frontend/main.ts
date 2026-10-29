import type {EntityCreate, EntityKey, EntityName, EntityResponse, EntityUpdate, DeleteDependencyCheck, EntityQuery} from '../backend/browser-contract.js';
import {ApiRequestError, checkDeleteDependencies, createRow, deleteRows, isAuthenticated, listEntities, updateRow, watchEntities} from './api.js';
import {createEntityCache} from './entity-cache.js';
import {entityPage} from './entity-query.js';
import {editColumnFilters} from './column-filters.js';
import {element} from './dom.js';
import {actionButton, setActionLabel} from './action-button.js';
import {createTableNavigation} from './table-navigation.js';
import {reviewRow} from './review-row.js';
import {initializeAuthentication} from './auth-ui.js';
import {loadReferenceSources, type LoadedReferenceSource} from './reference-sources.js';
import {confirmAction, showDeleteDependencies} from './confirm.js';
import {scrollCue, updateScrollCues} from './sheet-scroll.js';
import {rememberSheetContext} from './sheet-context.js';
import {createRowEditor, type RowEditor, type Row, type Value} from './row-editor.js';

let labels: Readonly<Record<string, string>> = {};

const workspace = document.querySelector<HTMLFieldSetElement>('#workspace')!;
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
const navigation = createTableNavigation(name => {
    if (workspace.disabled) return;
    if (currentEntity === name) navigation.activate(name);
    else void run(() => selectTab(name));
});

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

function rowKey(entity: EntityResponse, row: Row): EntityKey {
    const values: Readonly<Record<string, Value>> = row;
    return Object.fromEntries(entity.pk.map(name => [name, values[name]])) as EntityKey;
}

async function saveRow(entity: EntityResponse, editor: RowEditor, refresh: () => Promise<void>, previous?: {row: Row; version: string}): Promise<void> {
    editor.problems([]);
    if (!editor.valid()) return;
    await run(async () => {
        try {
            const input = editor.read();
            if (previous) await updateRow(entity.name, {key: rowKey(entity, previous.row), row: input,
                version: previous.version} as EntityUpdate);
            else await createRow(entity.name, input as EntityCreate);
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

async function selectTab(name: EntityName): Promise<void> {
    if (!await canLeaveView()) return;
    currentEntity = name;
    navigation.activate(name);
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
    let where: NonNullable<EntityQuery['where']> = {};
    let sortCol = '';
    let sortAsc = true;
    let page = 1;
    let pinnedColumn: string | null = null;
    let adding: RowEditor | undefined;
    const editors = new Map<Row, RowEditor>();
    const originals = new WeakMap<RowEditor, {row: Row; version: string}>();
    const selectedRows = new Map<string, Row>();
    const selectionKey = (row: Row) => JSON.stringify(rowKey(entity, row));
    let selectionCheck = 0;
    const pageSize = entity.browsing.pageSize;
    const query = (): EntityQuery => ({filter, ...(sortCol ? {sort: sortCol} : {}), direction: sortAsc ? 'asc' : 'desc', page, where});
    const dirty = () => !!adding || [...editors.values()].some(editor => editor.dirty());
    canLeaveView = async () => !dirty() || confirmAction({title: 'Descartar borrador',
        message: 'Cambiar de vista descartará los cambios sin guardar. ¿Continuar?', confirmText: 'Descartar', danger: true});
    let queryRevision = 0;
    const changeQuery = async (nextQuery: EntityQuery): Promise<boolean> => {
        if (!await canLeaveView()) { filterInput.value = filter; return false; }
        filter = nextQuery.filter ?? '';
        where = nextQuery.where ?? {};
        sortCol = nextQuery.sort ?? '';
        sortAsc = nextQuery.direction !== 'desc';
        page = nextQuery.page ?? 1;
        adding = undefined;
        editors.clear();
        const revision = ++queryRevision;
        table.inert = true;
        try {
            const next = await load(name, query());
            if (revision !== queryRevision || generation !== viewGeneration) return false;
            entity = next;
            render();
            return true;
        } catch (error) {
            if (!(error instanceof DOMException && error.name === 'AbortError')) status.textContent = error instanceof Error ? error.message : 'No se pudo cargar la página.';
        } finally { if (revision === queryRevision) table.inert = false; }
        return false;
    };

    const toolbar = element('div');
    toolbar.className = 'toolbar';
    const heading = element('div');
    heading.className = 'sheet-heading';
    const count = element('span');
    heading.append(element('h2', title), count);
    const filterInput = element('input');
    filterInput.className = 'filter-input';
    filterInput.placeholder = `Filtrar ${unit}…`;
    filterInput.setAttribute('aria-label', filterInput.placeholder);
    filterInput.oninput = () => { void changeQuery({...query(), filter: filterInput.value.trim(), page: 1}); };

    const selectionStatus = element('span');
    selectionStatus.setAttribute('role', 'status');
    selectionStatus.setAttribute('aria-live', 'polite');
    const deleteSelectedButton = actionButton('Borrar todos los seleccionados', 'delete', () => void onDeleteSelected(), 'danger');
    deleteSelectedButton.disabled = true;
    const columnFilters = actionButton('Filtrar por columnas', 'filter', () =>
        editColumnFilters(entity, where, selected => changeQuery({...query(), where: selected, page: 1})));
    toolbar.append(filterInput, columnFilters, deleteSelectedButton);
    toolbar.append(actionButton('Actualizar', 'refresh', () => { void run(async () => {
        if (dirty() && !await confirmAction({title: 'Descartar borrador', message: 'Actualizar descartará los cambios sin guardar. ¿Continuar?', confirmText: 'Descartar y actualizar', danger: true})) return;
        // Referenced rows may have changed outside the app, without a live event.
        for (const source of sources) cache.invalidate(source.reference.entity);
        await refresh();
    }); }));
    const addButton = actionButton('Agregar fila', 'add', () => { adding ??= createRowEditor(entity, sources); render(); }, 'primary');
    toolbar.append(addButton);
    const referenceNotice = element('div');
    referenceNotice.className = 'reference-notice';
    referenceNotice.setAttribute('role', 'status');

    async function refresh(preserveDrafts = false): Promise<void> {
        const revision = ++queryRevision;
        for (;;) try {
            cache.invalidate(name);
            const next = await load(name, query());
            const nextSources = await loadReferenceSources(next.foreignKeys, load);
            if (!isAuthenticated() || generation !== viewGeneration || revision !== queryRevision) return;
            const currentRows = new Map(next.rows.map((row, index) => [selectionKey(row), {row, version: next.versions[index]}]));
            const retained = preserveDrafts ? [...editors].filter(([row, editor]) => editor.dirty() ||
                currentRows.get(selectionKey(row))?.version === originals.get(editor)?.version) : [];
            entity = next;
            sources = nextSources;
            columns = createRowEditor(entity, sources, undefined, false).cells;
            if (!preserveDrafts) adding = undefined;
            editors.clear();
            for (const [row, editor] of retained) {
                editors.set(currentRows.get(selectionKey(row))?.row ?? row, editor);
            }
            for (const key of selectedRows.keys()) {
                const current = currentRows.get(key);
                if (current) selectedRows.set(key, current.row);
                else if (next.window.kind === 'complete') selectedRows.delete(key);
            }
            render();
            await refreshDeleteSelection();
            return;
        } catch (error) {
            if (!(error instanceof DOMException && error.name === 'AbortError')) throw error;
            if (!isAuthenticated() || generation !== viewGeneration || revision !== queryRevision) return;
            // Live invalidation can obsolete the reload following our own write.
        } finally { if (revision === queryRevision) table.inert = false; }
    }

    const afterSave = async (editor: RowEditor) => {
        const original = originals.get(editor)?.row;
        if (original && selectedRows.delete(selectionKey(original))) {
            const key = rowKey(entity, original);
            const input = editor.read();
            for (const name of entity.pk) if (input[name] != null) key[name] = input[name];
            const selected = {...original, ...key};
            selectedRows.set(selectionKey(selected), selected);
        }
        if (adding === editor) {
            adding = undefined;
            render();
        }
        await refresh(true);
    };

    let pendingRefresh = false;
    resumeLive = () => {
        if (!pendingRefresh || dirty() || workspace.disabled || table.contains(document.activeElement) || generation !== viewGeneration) return;
        pendingRefresh = false;
        void run(() => refresh(true));
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
    table.addEventListener('focusout', () => queueMicrotask(resumeLive));
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
            const th = element('th');
            th.scope = 'col';
            th.dataset['column'] = col.name;
            const heading = element('div');
            heading.className = 'column-heading';
            const sortable = entity.columns.some(column => column.name === col.name);
            const label = element(sortable ? 'button' : 'span', col.label + (sortCol === col.name ? (sortAsc ? ' ▲' : ' ▼') : ''));
            label.className = 'column-label';
            label.title = col.label;
            if (label instanceof HTMLButtonElement) {
                label.type = 'button';
                th.setAttribute('aria-sort', sortCol === col.name ? (sortAsc ? 'ascending' : 'descending') : 'none');
                label.onclick = () => {
                    void changeQuery({...query(), sort: col.name, direction: sortCol === col.name && sortAsc ? 'desc' : 'asc', page: 1} as EntityQuery);
                };
            }
            const pin = actionButton(`${pinnedColumn === col.name ? 'Soltar' : 'Fijar'} columna ${col.label}`, 'pin', () => {
                pinnedColumn = pinnedColumn === col.name ? null : col.name;
                render();
                scroll.scrollLeft = 0;
                [...headerRow.cells].find(cell => cell.dataset['column'] === col.name)?.querySelector<HTMLButtonElement>('.column-pin')?.focus();
            }, 'column-pin');
            pin.setAttribute('aria-pressed', String(pinnedColumn === col.name));
            heading.append(label, pin);
            th.append(heading);
            headerRow.append(th);
        }
        const actionsHeader = element('th', 'Acciones');
        actionsHeader.className = 'row-actions';
        actionsHeader.append(rightCue);
        headerRow.append(actionsHeader);
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
        setActionLabel(deleteSelectedButton, `Borrar seleccionados (${rows.length})`);
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
    const prevBtn = actionButton('Anterior', 'previous', () => { if (page > 1) void changeQuery({...query(), page: page - 1}); });
    const nextBtn = actionButton('Siguiente', 'next', () => { void changeQuery({...query(), page: page + 1}); });
    pagination.append(prevBtn, pageSpan, nextBtn);
    toolbar.append(pagination);

    const scroll = element('div');
    scroll.className = 'table-scroll';
    scroll.tabIndex = 0;
    scroll.setAttribute('role', 'region');
    scroll.setAttribute('aria-label', title);
    scroll.append(table);
    const leftCue = scrollCue(scroll, 'left');
    const rightCue = scrollCue(scroll, 'right');
    scroll.addEventListener('scroll', () => updateScrollCues(scroll), {passive: true});

    function render(): void {
        const restoreContext = rememberSheetContext(scroll);
        if (!columns.some(column => column.name === pinnedColumn)) pinnedColumn = null;
        renderHeaders();

        const result = entityPage(entity, query());
        const totalPages = Math.max(1, Math.ceil(result.matched / pageSize));
        page = result.page;
        const start = (page - 1) * pageSize;
        const paged = result.rows;

        setActionLabel(columnFilters, `Filtrar por columnas (${Object.keys(where ?? {}).length})`);
        count.textContent = filter || Object.keys(where ?? {}).length ? `${result.matched} de ${result.total} ${unit}` : `${result.total} ${unit}`;
        pageSpan.textContent = `${page} / ${totalPages}`;
        pageSpan.setAttribute('aria-label', `Página ${page} de ${totalPages}`);
        pageSpan.title = `Página ${page} de ${totalPages}`;
        prevBtn.disabled = page <= 1;
        nextBtn.disabled = page >= totalPages;
        selectVisible.disabled = paged.length === 0;
        selectVisible.checked = paged.length > 0 && paged.every(row => selectedRows.has(selectionKey(row)));
        selectVisible.indeterminate = paged.some(row => selectedRows.has(selectionKey(row))) && !selectVisible.checked;
        setActionLabel(deleteSelectedButton, `Borrar seleccionados (${selectedRows.size})`);
        renderMissingReferences();

        tbody.replaceChildren();

        if (adding) {
            const tr = tbody.insertRow();
            tr.className = 'new-row';
            tr.dataset['key'] = 'new';
            const selection = tr.insertCell();
            selection.className = 'selection-col';
            const num = tr.insertCell();
            num.className = 'row-idx';
            num.textContent = '+';

            const editor = adding;
            appendCells(tr, editor);

            const actions = tr.insertCell();
            actions.className = 'row-actions';
            actions.append(
                actionButton('Guardar', 'save', () => void saveRow(entity, editor, () => afterSave(editor)), 'primary'),
                actionButton('Cancelar', 'cancel', () => {
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
            tr.dataset['key'] = selectionKey(row);
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
                originals.set(editor, {row, version});
                editors.set(row, editor);
            }
            const editor = editors.get(row)!;
            appendCells(tr, editor);

            const actions = tr.insertCell();
            actions.className = 'row-actions';
            const save = actionButton('Guardar', 'save', () => void saveRow(entity, editor, () => afterSave(editor), originals.get(editor)!), 'primary');
            const cancel = actionButton('Cancelar', 'cancel', () => {
                void confirmAction({title: 'Descartar cambios de la fila', message: '¿Descartar los cambios sin guardar de esta fila?',
                    confirmText: 'Descartar', danger: true}).then(ok => {
                    if (!ok) return;
                    editors.delete(row);
                    render();
                });
            });
            const updateActions = () => {
                save.hidden = cancel.hidden = !editor.dirty();
                tr.classList.toggle('draft-row', editor.dirty());
            };
            tr.addEventListener('input', updateActions);
            tr.addEventListener('change', updateActions);
            updateActions();
            actions.append(save, cancel);
            actions.append(actionButton('Ver datos actuales', 'review', () => void run(async () => {
                cache.invalidate(name);
                const query = {where: rowKey(entity, row)} as EntityQuery;
                const current = entityPage(await load(name, query), query).rows[0];
                reviewRow(entity, row, editor.read(), current);
            })));
        });
        for (const row of table.rows) {
            const pinned = [...row.cells].find(cell => cell.dataset['column'] === pinnedColumn);
            if (pinned) {
                pinned.classList.add('pinned-col');
                row.insertBefore(pinned, row.cells[1]!);
            }
        }
        // Anchor the left cue after any pinned column, over the scrolling headers.
        (headerRow.querySelector('.pinned-col') ?? selectTh).append(leftCue);
        updateScrollCues(scroll);
        restoreContext();
    }

    function renderMissingReferences(): void {
        // A required reference to an empty entity makes every new row unsaveable.
        const missing = sources.filter(({reference, target}) => entity.foreignKeys.includes(reference) &&
            Object.keys(reference.fields).some(field => entity.inputs.find(column => column.name === field)?.nullable === false) &&
            (target.window.kind === 'page' ? target.window.total : target.rows.length) === 0);
        const message = `Para agregar ${unit} primero tiene que haber al menos ${
            new Intl.ListFormat('es').format(missing.map(({reference}) => `1 ${reference.name}`))}.`;
        addButton.disabled = missing.length > 0;
        addButton.title = missing.length ? message : 'Agregar fila';
        referenceNotice.replaceChildren(...missing.length ? [element('span', `⚠ ${message}`),
            ...missing.map(({target}) => actionButton(`Ir a ${target.label}`, 'next', () => void run(() => selectTab(target.name))))] : []);
    }

    function appendCells(row: HTMLTableRowElement, editor: RowEditor): void {
        for (const {name, field} of editor.cells) {
            const cell = row.insertCell();
            cell.dataset['column'] = name;
            cell.append(field);
        }
    }

    render();
    const controls = element('div');
    controls.className = 'sheet-controls';
    controls.append(heading, toolbar, referenceNotice, selectionStatus);
    content.replaceChildren(controls, scroll);
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
        navigation.catalog([]);
        return;
    }
    void run(async () => {
        const catalog = await listEntities();
        if (!isAuthenticated()) return;
        allEntities = catalog.map(entity => entity.name);
        labels = Object.fromEntries(catalog.map(entity => [entity.name, entity.label]));
        navigation.catalog(catalog);
        if (allEntities[0]) await selectTab(allEntities[0]);
        else content.textContent = 'No hay planillas disponibles.';
        stopWatching = watchEntities(name => { cache.invalidate(name); invalidateView(name); });
    });
});

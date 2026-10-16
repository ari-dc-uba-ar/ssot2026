import type {EntityColumn, EntityCreate, EntityKey, EntityName, EntityResponse, EntityRow, EntityUpdate} from '../backend/api-contract.js';
import {ApiRequestError, createRow, deleteRow, isAuthenticated, listEntities, loadEntity, updateRow} from './api.js';
import {messageOf} from './messages.js';
import {initializeAuthentication} from './auth-ui.js';
import {referenceOptions} from './foreign-keys.js';
import {confirmAction} from './confirm.js';

type Column = EntityColumn<EntityName>;
type Row = EntityRow<EntityName>;
type Value = {[E in EntityName]: EntityRow<E>[keyof EntityRow<E>]}[EntityName];

const labels: Readonly<Record<string, string>> = {
    materias: 'Materias',
    pabellones: 'Pabellones',
    planes: 'Planes de Estudio',
    usuarios: 'Usuarios',
};

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

function editorFor(column: Column, fkOptions?: {label: string; value: Value}[]) {
    if (fkOptions) {
        const select = element('select');
        if (column.nullable) select.add(new Option('(sin valor)', ''));
        for (const opt of fkOptions) {
            select.add(new Option(opt.label, String(opt.value)));
        }
        if (column.writable === false) select.disabled = true;
        return {
            input: select,
            read: () => select.value === '' ? null : (column.type === 'integer' ? Number(select.value) : select.value) as Value,
        };
    }
    const ed = editors[column.type]();
    if (column.nullable && column.type === 'boolean') {
        (ed.input as HTMLSelectElement).prepend(new Option('(sin valor)', ''));
    }
    if (column.writable === false) ed.input.disabled = true;
    return {
        input: ed.input,
        read: () => column.nullable && ed.input.value === '' ? null : ed.read(),
    };
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

async function onCellChange(entity: EntityResponse, row: Row, col: Column, td: HTMLTableCellElement, next: Value): Promise<void> {
    const updated = {...row, [col.name]: next} as Row;
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
    fields.forEach(f => f.td.classList.remove('has-error'));
    const next = Object.fromEntries(fields.map(f => [f.col.name, f.ed.read()])) as Row;
    await run(async () => {
        try {
            await createRow(entity.name, next as EntityCreate<EntityName>);
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

    const foreign = new Map<string, {label: string; value: Value}[]>();
    for (const fk of entity.foreignKeys) {
        const target = await load(fk.entity);
        const options = referenceOptions(fk, target.rows);
        for (const localField of Object.keys(fk.fields)) {
            foreign.set(localField, options.map(opt => ({label: opt.label, value: opt.values[localField] as Value})));
        }
    }

    let filter = '';
    let sortCol = '';
    let sortAsc = true;
    let page = 1;
    let adding = false;
    const pageSize = 10;

    const toolbar = element('div');
    toolbar.className = 'toolbar';
    const count = element('span');
    const filterInput = element('input');
    filterInput.className = 'filter-input';
    filterInput.placeholder = `Filtrar ${unit}…`;
    filterInput.oninput = () => { filter = filterInput.value.toLowerCase().trim(); page = 1; render(); };

    toolbar.append(
        element('h2', title),
        count,
        filterInput,
        button('+ Agregar fila', () => { adding = true; render(); }, 'primary')
    );

    const table = element('table');
    const headerRow = table.createTHead().insertRow();
    const idxTh = element('th', '#');
    idxTh.className = 'row-idx';
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
            headerRow.cells[idx + 1]!.textContent = col.label + (sortCol === col.name ? (sortAsc ? ' ▲' : ' ▼') : '');
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

        tbody.replaceChildren();

        if (adding) {
            const tr = tbody.insertRow();
            tr.className = 'new-row';
            const num = tr.insertCell();
            num.className = 'row-idx';
            num.textContent = '+';

            const fields = entity.columns.filter(col => col.writable !== false).map(col => {
                const ed = editorFor(col, foreign.get(col.name));
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
            const num = tr.insertCell();
            num.className = 'row-idx';
            num.textContent = String(start + i + 1);

            for (const col of entity.columns) {
                const td = tr.insertCell();
                const ed = editorFor(col, foreign.get(col.name));
                const val = (row as Record<string, Value>)[col.name];
                ed.input.value = val == null ? '' : String(val);
                let prev = ed.read();
                ed.input.onchange = () => {
                    const next = ed.read();
                    if (next !== prev) {
                        prev = next;
                        void onCellChange(entity, row, col, td, next);
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
        content.append(element('p', `No hay ${unit} registradas. Agregá la primera para comenzar.`));
    }
}

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

import type {EntityName, EntityQuery, ReportDefinition, ReportMeasure, ReportJoin} from '../backend/browser-contract.js';
import type {createEntityCache} from './entity-cache.js';
import {loadReport, loadReportDefinition} from './api.js';
import {element} from './dom.js';
import {actionButton} from './action-button.js';
import {queryControls} from './query-controls.js';
import {removeReportJoin} from './report-joins.js';

export function reportsPage(catalog: Readonly<Record<EntityName, string>>, source: ReturnType<typeof createEntityCache>) {
    const node = element('section');
    node.className = 'reports-page';
    const form = element('form');
    const tables = element('select');
    tables.setAttribute('aria-label', 'Tabla del reporte');
    for (const [name, label] of Object.entries(catalog)) {
        const option = element('option', label);
        option.value = name;
        tables.append(option);
    }
    const choices = element('details');
    choices.open = true;
    choices.append(element('summary', 'Definir reporte'));
    const groups = element('fieldset'), measures = element('fieldset');
    groups.className = 'report-groups';
    measures.className = 'report-measures';
    choices.append(groups, measures);
    const generate = element('button', 'Generar reporte');
    generate.type = 'submit';
    generate.className = 'primary';
    let definition: ReportDefinition | undefined, revision = 0, disposed = false;
    let joins: ReportJoin[] = [];
    const joinPanel = element('fieldset');
    joinPanel.className = 'report-joins';
    const steps = element('div');
    const origin = element('select');
    origin.setAttribute('aria-label', 'Origen de la relación');
    const relationship = element('select');
    relationship.setAttribute('aria-label', 'Relación');
    const kind = joinKind();
    kind.setAttribute('aria-label', 'Tipo de nueva unión');
    const addJoin = element('button', 'Agregar relación');
    addJoin.type = 'button';
    addJoin.onclick = () => {
        joins = [...joins, {source: Number(origin.value), relationship: relationship.value, kind: kind.value as ReportJoin['kind']}];
        void selectTable();
    };
    joinPanel.append(element('legend', 'Relacionar tablas'), steps, origin, relationship, kind, addJoin);
    let filters: EntityQuery = {}, page = 1;
    const selectedGroups = new Map<string, HTMLInputElement>();
    const selectedMeasures: {input: HTMLInputElement; measure: ReportMeasure}[] = [];
    const controls = queryControls(() => filters, async query => { filters = query; await render(1); }, {sortable: false});
    const status = element('p');
    status.setAttribute('role', 'status');
    const previous = actionButton('Página anterior del reporte', 'previous', () => void render(page - 1));
    const next = actionButton('Página siguiente del reporte', 'next', () => void render(page + 1));
    const refresh = actionButton('Actualizar reporte', 'refresh', () => { void (definition ? render() : selectTable()); });
    const pagination = element('div');
    pagination.className = 'related-controls';
    pagination.append(previous, status, next, refresh);
    const results = element('div');
    results.className = 'report-results';
    results.tabIndex = 0;
    results.setAttribute('role', 'region');
    results.setAttribute('aria-label', 'Resultados del reporte');
    form.append(tables, joinPanel, choices, generate);
    form.onsubmit = event => { event.preventDefault(); void render(1); };
    const explanation = element('details');
    explanation.append(element('summary', 'Cómo se cuentan y filtran los datos'),
        element('p', 'Los filtros se aplican después de unir y antes de agrupar. Filtrar por un valor de la tabla relacionada puede excluir filas sin coincidencia. Las uniones pueden repetir registros: usá registros distintos para contar entidades. Sumas y promedios usan las filas resultantes. Al cambiar uniones se reinician los campos y filtros del reporte.'));
    form.append(explanation);
    node.append(element('h2', 'Reportes'), form, controls.node, pagination, results);

    function joinKind(value: ReportJoin['kind'] = 'inner') {
        const select = element('select');
        for (const [key, label] of [['inner', 'Solo coincidencias'], ['left', 'Conservar filas sin coincidencia']]) {
            const option = element('option', label);
            option.value = key!;
            select.append(option);
        }
        select.value = value;
        return select;
    }
    function relationships() {
        relationship.replaceChildren();
        for (const edge of definition?.sources[Number(origin.value)]?.relationships ?? []) {
            const option = element('option', edge.label);
            option.value = edge.id;
            relationship.append(option);
        }
        addJoin.disabled = relationship.options.length === 0;
    }
    origin.onchange = relationships;
    function renderJoins(value: ReportDefinition) {
        origin.replaceChildren();
        for (const source of value.sources) {
            const option = element('option', source.label);
            option.value = String(source.index);
            origin.append(option);
        }
        steps.replaceChildren();
        joins.forEach((join, index) => {
            const step = element('div');
            step.className = 'report-join-step';
            step.append(element('span', `${value.sources[join.source]!.label} → ${value.sources[index + 1]!.label}`));
            const select = joinKind(join.kind);
            select.setAttribute('aria-label', `Tipo de unión ${index + 1}`);
            select.onchange = () => {
                joins = joins.map((previous, i) => i === index ? {...previous, kind: select.value as ReportJoin['kind']} : previous);
                void selectTable();
            };
            const remove = actionButton(`Quitar unión ${index + 1} y sus dependientes`, 'delete', () => {
                joins = removeReportJoin(joins, index + 1);
                void selectTable();
            });
            step.append(select, remove);
            steps.append(step);
        });
        relationships();
    }

    function checkbox(parent: HTMLElement, label: string, checked = false) {
        const input = element('input');
        input.type = 'checkbox';
        input.checked = checked;
        const wrapper = element('label');
        wrapper.append(input, document.createTextNode(label));
        parent.append(wrapper);
        return input;
    }
    async function selectTable() {
        const current = ++revision;
        definition = undefined;
        joinPanel.disabled = true;
        controls.node.inert = true;
        generate.disabled = true;
        previous.disabled = next.disabled = true;
        filters = {};
        groups.replaceChildren(element('legend', 'Agrupar por'));
        measures.replaceChildren(element('legend', 'Medidas'));
        selectedGroups.clear();
        selectedMeasures.length = 0;
        results.replaceChildren();
        status.textContent = 'Cargando…';
        try {
            const value = await loadReportDefinition(tables.value, joins);
            if (disposed || current !== revision) return;
            definition = value;
            renderJoins(value);
            joinPanel.disabled = false;
            selectedMeasures.push({input: checkbox(measures, value.rowCount.label, true), measure: {operation: value.rowCount.operation}});
            for (const source of value.sources) if (source.distinctRecords) selectedMeasures.push({
                input: checkbox(measures, `Registros distintos · ${source.label}`), measure: {operation: 'countDistinct', source: source.index},
            });
            for (const column of value.columns) {
                selectedGroups.set(column.name, checkbox(groups, column.label));
                const field = element('fieldset');
                field.append(element('legend', column.label));
                for (const aggregate of column.aggregates) selectedMeasures.push({
                    input: checkbox(field, aggregate.label), measure: {field: column.name, operation: aggregate.operation},
                });
                measures.append(field);
            }
            controls.update(value.columns);
            controls.node.inert = false;
            generate.disabled = false;
            await render(1);
        } catch (error) {
            if (!disposed && current === revision) status.textContent = error instanceof Error ? error.message : 'No se pudo cargar el reporte.';
        }
    }
    async function render(requested = page): Promise<void> {
        if (!definition || disposed) return;
        const current = ++revision;
        status.textContent = 'Cargando…';
        previous.disabled = next.disabled = true;
        node.setAttribute('aria-busy', 'true');
        try {
            const response = await loadReport(definition.name, {
                ...filters, page: requested, joins,
                groupBy: [...selectedGroups].filter(([, input]) => input.checked).map(([name]) => name),
                measures: selectedMeasures.filter(({input}) => input.checked).map(({measure}) => measure),
            });
            if (disposed || current !== revision) return;
            page = response.page;
            const pages = Math.max(1, Math.ceil(response.total / response.pageSize));
            status.textContent = `${response.total} resultados · ${page} / ${pages}`;
            previous.disabled = page <= 1;
            next.disabled = page >= pages;
            controls.update(definition.columns);
            const table = element('table');
            const header = table.createTHead().insertRow();
            for (const column of response.columns) header.append(element('th', column.label));
            const body = table.createTBody();
            for (const row of response.rows) {
                const tr = body.insertRow();
                for (const column of response.columns) tr.insertCell().textContent = row[column.name] == null ? 'Ninguna' : String(row[column.name]);
            }
            results.replaceChildren(response.rows.length ? table : element('p', 'Sin resultados.'));
        } catch (error) {
            if (!disposed && current === revision) {
                results.replaceChildren();
                status.textContent = error instanceof Error ? error.message : 'No se pudo generar el reporte.';
            }
        } finally {
            if (!disposed && current === revision) node.setAttribute('aria-busy', 'false');
        }
    }
    tables.onchange = () => { joins = []; void selectTable(); };
    const stop = source.subscribe(name => { if (name === null || definition?.sources.some(source => source.entity === name)) void render(); });
    if (tables.options.length) void selectTable();
    return {node, dispose() { disposed = true; revision++; stop(); }};
}

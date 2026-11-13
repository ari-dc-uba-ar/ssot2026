import type {EntityResponse, EntityRow, EntityQuery} from '../backend/browser-contract.js';
import {createEntityCache} from './entity-cache.js';
import {loadRelatedPage} from './related-page.js';
import {element} from './dom.js';
import {actionButton} from './action-button.js';
import {queryControls} from './query-controls.js';

export function relatedRows(entity: EntityResponse, row: EntityRow, source: ReturnType<typeof createEntityCache>, {collapsed = false} = {}) {
    // Visited pages live only as long as this review dialog.
    const cache = createEntityCache(source.load, {retainPages: true});
    let disposed = false;
    const views = entity.referencedBy.map(relationship => {
        const section = element('details');
        section.open = !collapsed;
        section.className = 'related-rows';
        section.dataset['entity'] = relationship.entity;
        section.dataset['relationship'] = relationship.name;
        section.append(element('summary', `${relationship.label} · ${relationship.name}`));
        const controls = element('div');
        controls.className = 'related-controls';
        const count = element('span');
        count.setAttribute('role', 'status');
        const body = element('div');
        body.className = 'related-scroll';
        body.tabIndex = 0;
        body.setAttribute('role', 'region');
        body.setAttribute('aria-label', `${relationship.label} · ${relationship.name}`);
        let page = 1, revision = 0;
        let query: EntityQuery = {};
        const filters = queryControls(() => query, async next => { query = next; await render(1); });
        const dependencies = new Set([entity.name, relationship.entity]);
        const previous = actionButton('Anterior', 'previous', () => void render(page - 1));
        const next = actionButton('Siguiente', 'next', () => void render(page + 1));
        const refresh = actionButton('Actualizar registros relacionados', 'refresh', () => source.invalidate(relationship.entity));
        controls.append(previous, count, next, refresh);
        section.append(filters.node, controls, body);
        async function render(requested = page): Promise<void> {
            const current = ++revision;
            page = requested;
            previous.disabled = next.disabled = true;
            section.setAttribute('aria-busy', 'true');
            count.textContent = 'Cargando…';
            try {
                const result = await loadRelatedPage(relationship, row, page, (name, query) => {
                    dependencies.add(name);
                    return cache.load(name, query);
                }, query);
                if (disposed || current !== revision) return;
                page = result?.page ?? 1;
                filters.update(result?.fields ?? []);
                count.textContent = `${result?.matched ?? 0} registros · ${page} / ${result?.totalPages ?? 1}`;
                previous.disabled = page <= 1;
                next.disabled = page >= (result?.totalPages ?? 1);
                if (!result?.rows.length) { body.replaceChildren(element('p', 'Sin registros.')); return; }
                const table = element('table');
                const header = table.createTHead().insertRow();
                for (const column of result.columns) header.append(element('th', column.label));
                const rows = table.createTBody();
                result.rows.forEach((_, index) => {
                    const tr = rows.insertRow();
                    for (const column of result.columns) tr.insertCell().textContent = column.values[index]!;
                });
                body.replaceChildren(table);
            } catch (error) {
                if (disposed || current !== revision) return;
                count.textContent = error instanceof Error ? error.message : 'No se pudieron cargar los registros.';
            } finally {
                if (!disposed && current === revision) section.setAttribute('aria-busy', 'false');
            }
        }
        section.ontoggle = () => { if (section.open) void render(); };
        return {section, dependencies, render};
    });
    const stop = source.subscribe(name => {
        cache.invalidate(name);
        for (const view of views) if (view.section.open && (name === null || view.dependencies.has(name))) void view.render();
    });
    return {
        sections: views.map(view => view.section),
        dispose() { disposed = true; stop(); cache.clear(); },
    };
}

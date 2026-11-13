import type {EntityResponse, EntityQuery} from '../backend/browser-contract.js';
import {element} from './dom.js';
import {actionButton, setActionLabel} from './action-button.js';
import {editColumnFilters} from './column-filters.js';

// Shared read-only query controls; metadata determines the selectable fields.
export function queryControls(read: () => EntityQuery, change: (query: EntityQuery) => Promise<void>, {sortable = true} = {}) {
    const node = element('div');
    node.className = 'query-controls';
    let columns: EntityResponse['columns'] = [];
    const search = element('input');
    search.type = 'search';
    search.placeholder = 'Buscar…';
    search.setAttribute('aria-label', 'Buscar registros');
    search.oninput = () => void change({...read(), filter: search.value, page: 1});
    const filters = actionButton('Filtrar por columnas', 'filter', () => editColumnFilters({columns}, read().where, async where => {
        await change({...read(), where, page: 1});
        return true;
    }));
    const sort = element('select');
    sort.setAttribute('aria-label', 'Ordenar por');
    sort.onchange = () => {
        const {sort: _previous, ...query} = read();
        void change({...query, ...(sort.value ? {sort: sort.value} : {}), page: 1});
    };
    const direction = element('button');
    direction.type = 'button';
    direction.onclick = () => void change({...read(), direction: read().direction === 'desc' ? 'asc' : 'desc', page: 1});
    node.append(search, filters, sort, direction);
    sort.hidden = direction.hidden = !sortable;
    return {node, update(available: EntityResponse['columns']) {
        columns = available;
        sort.replaceChildren(element('option', 'Orden original'));
        sort.options[0]!.value = '';
        for (const column of columns) {
            const option = element('option', column.label);
            option.value = column.name;
            sort.append(option);
        }
        sort.value = read().sort ?? '';
        search.value = read().filter ?? '';
        direction.textContent = read().direction === 'desc' ? '↓' : '↑';
        direction.setAttribute('aria-label', read().direction === 'desc' ? 'Orden descendente' : 'Orden ascendente');
        setActionLabel(filters, `Filtrar por columnas (${Object.keys(read().where ?? {}).length})`);
    }};
}

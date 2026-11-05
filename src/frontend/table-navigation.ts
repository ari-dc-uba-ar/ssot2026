import type {EntityNamesResponse} from '../backend/browser-contract.js';
import {element} from './dom.js';
import {observeSheetLayout} from './sheet-layout.js';

export function createTableNavigation(select: (name: string) => void) {
    const toggle = document.querySelector<HTMLButtonElement>('#open-tables')!;
    const panel = document.querySelector<HTMLDialogElement>('#tables-panel')!;
    const search = document.querySelector<HTMLInputElement>('#table-search')!;
    const list = document.querySelector<HTMLElement>('#table-list')!;
    const layout = observeSheetLayout(panel, toggle);
    const buttons = () => [...list.querySelectorAll<HTMLButtonElement>('button[data-entity]')];
    toggle.onclick = () => { panel.showModal(); toggle.setAttribute('aria-expanded', 'true'); };
    document.querySelector<HTMLButtonElement>('#close-tables')!.onclick = () => panel.close();
    panel.addEventListener('close', () => toggle.setAttribute('aria-expanded', 'false'));
    search.oninput = () => {
        const filter = search.value.trim().toLocaleLowerCase();
        for (const button of buttons()) button.hidden = !button.textContent!.toLocaleLowerCase().includes(filter);
        for (const group of list.querySelectorAll<HTMLDetailsElement>('details')) {
            const matches = [...group.querySelectorAll('button')].some(button => !button.hidden);
            group.hidden = !matches;
            group.open = true;
        }
        layout();
    };
    return {
        catalog(entries: EntityNamesResponse) {
            toggle.hidden = entries.length === 0;
            search.value = '';
            panel.close();
            const groups = new Map<string, HTMLDetailsElement>();
            for (const {name, label, area} of entries) {
                let group = groups.get(area);
                if (!group) {
                    group = element('details');
                    group.className = 'menu-group';
                    group.open = true;
                    group.append(element('summary', area));
                    
                    group.addEventListener('toggle', layout);
                    groups.set(area, group);
                }
                
                const button = element('button', label);
                button.type = 'button';
                button.dataset['entity'] = name;
                button.onclick = () => select(name);
                group.append(button);
            }
            list.replaceChildren(...groups.values());
            layout();
        },
        activate(name: string) {
            for (const button of buttons()) {
                const current = button.dataset['entity'] === name;
                button.setAttribute('aria-current', String(current));
                if (current) button.closest('details')!.open = true;
            }
            if (panel.matches(':modal')) panel.close();
            layout();
        },
    };
}

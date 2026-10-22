import type {EntityNamesResponse} from '../backend/browser-contract.js';
import {element} from './dom.js';
import {observeSheetLayout} from './sheet-layout.js';

export function createTableNavigation(select: (name: string) => void) {
    const toggle = document.querySelector<HTMLButtonElement>('#open-tables')!;
    const panel = document.querySelector<HTMLDialogElement>('#tables-panel')!;
    const search = document.querySelector<HTMLInputElement>('#table-search')!;
    const list = document.querySelector<HTMLElement>('#table-list')!;
    const layout = observeSheetLayout(panel, toggle);
    toggle.onclick = () => { panel.showModal(); toggle.setAttribute('aria-expanded', 'true'); };
    document.querySelector<HTMLButtonElement>('#close-tables')!.onclick = () => panel.close();
    panel.addEventListener('close', () => toggle.setAttribute('aria-expanded', 'false'));
    search.oninput = () => {
        const filter = search.value.trim().toLocaleLowerCase();
        for (const item of list.children) {
            (item as HTMLElement).hidden = !item.textContent!.toLocaleLowerCase().includes(filter);
        }
        layout();
    };
    return {
        catalog(entries: EntityNamesResponse) {
            toggle.hidden = entries.length === 0;
            search.value = '';
            panel.close();
            list.replaceChildren(...entries.map(({name, label}) => {
                const button = element('button', label);
                button.type = 'button';
                button.dataset['entity'] = name;
                button.onclick = () => select(name);
                return button;
            }));
            layout();
        },
        activate(name: string) {
            for (const item of list.children) {
                const button = item as HTMLButtonElement;
                button.setAttribute('aria-current', String(button.dataset['entity'] === name));
            }
            if (panel.matches(':modal')) panel.close();
            layout();
        },
    };
}

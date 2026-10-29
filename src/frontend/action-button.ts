import {element} from './dom.js';

const icons = {
    add: 'M12 5v14M5 12h14',
    filter: 'M3 4h18l-7 8v7l-4 2v-9z',
    delete: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
    refresh: 'M20 7v5h-5M4 17v-5h5M5 8a7 7 0 0 1 12-3l3 7M4 12l3 7a7 7 0 0 0 12-3',
    review: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8',
    cancel: 'M6 6l12 12M6 18L18 6',
    previous: 'M15 5l-7 7 7 7',
    next: 'M9 5l7 7-7 7',
    pin: 'M8 3h8M9 3v6l-3 4v2h12v-2l-3-4V3M12 15v6',
} as const;

export function setActionLabel(button: HTMLButtonElement, label: string): void {
    button.setAttribute('aria-label', label);
    button.title = label;
    button.querySelector('.action-label')!.textContent = label;
}

export function actionButton(label: string, icon: keyof typeof icons, action: () => void, className = ''): HTMLButtonElement {
    const button = element('button');
    button.type = 'button';
    button.className = `icon-action ${className}`;
    button.onclick = action;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', icons[icon]);
    svg.append(path);
    const text = element('span');
    text.className = 'action-label';
    button.append(svg, text);
    setActionLabel(button, label);
    return button;
}

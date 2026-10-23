import {actionButton} from './action-button.js';

export function scrollCue(scroll: HTMLElement, direction: 'left' | 'right'): HTMLButtonElement {
    const left = direction === 'left';
    const button = actionButton(`Ver más columnas a la ${left ? 'izquierda' : 'derecha'}`, left ? 'previous' : 'next', () => {
        const fixedWidth = ['.selection-col', '.pinned-col', '.row-actions'].reduce((width, selector) =>
            width + (scroll.querySelector(`thead ${selector}`)?.getBoundingClientRect().width ?? 0), 0);
        scroll.scrollBy({left: (left ? -1 : 1) * Math.max(1, scroll.clientWidth - fixedWidth)});
    }, 'scroll-cue');
    button.dataset['direction'] = direction;
    return button;
}

export function updateScrollCues(scroll: HTMLElement): void {
    if (!scroll.isConnected) return;
    const remaining = scroll.scrollWidth - scroll.clientWidth - scroll.scrollLeft;
    // One pixel tolerates rounded layout dimensions and fractional scroll positions.
    scroll.classList.toggle('horizontal-overflow', scroll.scrollWidth - scroll.clientWidth > 1);
    for (const button of scroll.querySelectorAll<HTMLButtonElement>('.scroll-cue')) {
        button.disabled = (button.dataset['direction'] === 'left' ? scroll.scrollLeft : remaining) <= 1;
    }
}

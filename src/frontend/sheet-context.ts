// Rendering a row must not discard the caret or scroll position of another edit.
export function rememberSheetContext(scroll: HTMLElement): () => void {
    const active = document.activeElement;
    const focused = active instanceof HTMLElement && scroll.contains(active) ? active : undefined;
    const key = focused?.closest('tr')?.dataset['key'];
    const name = focused?.getAttribute('name');
    const label = focused?.getAttribute('aria-label');
    const caret = focused instanceof HTMLInputElement && focused.selectionStart !== null
        ? [focused.selectionStart, focused.selectionEnd ?? focused.selectionStart] as const : undefined;
    const {scrollLeft, scrollTop} = scroll;
    return () => {
        const row = key === undefined ? scroll : [...scroll.querySelectorAll('tr')].find(row => row.dataset['key'] === key);
        const target = focused?.isConnected ? focused : [...row?.querySelectorAll<HTMLElement>('input, select, button') ?? []]
            .find(node => name ? node.getAttribute('name') === name : label && node.getAttribute('aria-label') === label);
        if (target && !target.hidden && !target.matches(':disabled')) {
            target.focus({preventScroll: true});
            if (caret && target instanceof HTMLInputElement && target.selectionStart !== null) target.setSelectionRange(...caret);
        }
        scroll.scrollLeft = scrollLeft;
        scroll.scrollTop = scrollTop;
    };
}

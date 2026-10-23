// Fit actual content instead of choosing a screen-width breakpoint.
export function observeSheetLayout(panel: HTMLDialogElement, toggle: HTMLButtonElement): () => void {
    const workspace = document.querySelector<HTMLElement>('#workspace')!;
    const content = document.querySelector<HTMLElement>('#content')!;
    let frame = 0;
    let observedTable: HTMLTableElement | null = null;
    function fit() {
        frame = 0;
        const table = content.querySelector('table');
        if (table !== observedTable) {
            resize.disconnect();
            resize.observe(workspace);
            if (table) resize.observe(table);
            observedTable = table;
        }
        if (workspace.hidden || !table || panel.matches(':modal')) return;
        const panelStyle = panel.getAttribute('style');
        panel.style.cssText = 'display: block; visibility: hidden; width: max-content; max-width: none';
        const panelWidth = panel.getBoundingClientRect().width;
        if (panelStyle === null) panel.removeAttribute('style');
        else panel.setAttribute('style', panelStyle);
        const tableWidth = table.style.width;
        table.style.width = 'max-content';
        content.classList.remove('roomy-actions');
        const gap = parseFloat(getComputedStyle(workspace).columnGap) || 0;
        const docked = panelWidth + table.getBoundingClientRect().width + gap <= workspace.clientWidth;
        workspace.classList.toggle('docked', docked);
        toggle.hidden = docked;
        if (docked && !panel.open) panel.show();
        if (!docked && panel.open) panel.close();
        content.classList.add('roomy-actions');
        const available = workspace.clientWidth - (docked ? panelWidth + gap : 0);
        content.classList.toggle('roomy-actions', table.getBoundingClientRect().width <= available);
        table.style.width = tableWidth;
        const scroll = content.querySelector<HTMLElement>('.table-scroll')!;
        const selectionWidth = table.querySelector('.selection-col')!.getBoundingClientRect().width;
        const actionsWidth = table.querySelector('.row-actions')!.getBoundingClientRect().width;
        table.style.setProperty('--selection-width', `${selectionWidth}px`);
        // Share the remaining viewport between the pinned column and scrolling data.
        table.style.setProperty('--pinned-width', `${Math.max(0, (scroll.clientWidth - selectionWidth - actionsWidth) / 2)}px`);
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(fit); };
    const resize = new ResizeObserver(schedule);
    resize.observe(workspace);
    // Row editors, translated labels and new table metadata can change intrinsic widths.
    const changes = new MutationObserver(schedule);
    changes.observe(content, {childList: true, subtree: true, characterData: true});
    changes.observe(panel, {childList: true, subtree: true, characterData: true});
    panel.addEventListener('close', schedule);
    document.fonts.ready.then(schedule);
    return schedule;
}

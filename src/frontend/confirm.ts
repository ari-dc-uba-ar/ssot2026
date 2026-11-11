import type {DeleteDependencyBlocker} from '../backend/browser-contract.js';

export function confirmAction(options: {
    title?: string;
    message: string;
    confirmText?: string;
    danger?: boolean;
}): Promise<boolean> {
    const dialog = document.querySelector<HTMLDialogElement>('#confirm-dialog');
    if (!dialog) return Promise.resolve(confirm(options.message));
    const titleEl = document.querySelector<HTMLElement>('#confirm-title');
    const messageEl = document.querySelector<HTMLElement>('#confirm-message');
    const okBtn = document.querySelector<HTMLButtonElement>('#confirm-ok');
    const cancelBtn = document.querySelector<HTMLButtonElement>('#confirm-cancel');

    if (titleEl) titleEl.textContent = options.title ?? 'Confirmar acción';
    if (messageEl) messageEl.textContent = options.message;
    if (okBtn) {
        okBtn.textContent = options.confirmText ?? 'Confirmar';
        okBtn.className = options.danger !== false ? 'danger primary' : 'primary';
    }
    dialog.classList.remove('result-success', 'result-error');
    const icon = dialog.querySelector<HTMLElement>('.confirm-icon');
    if (icon) icon.textContent = '⚠️';
    if (cancelBtn) cancelBtn.hidden = false;

    dialog.showModal();

    return new Promise(resolve => {
        const cleanup = (result: boolean) => {
            dialog.close();
            if (okBtn) okBtn.onclick = null;
            if (cancelBtn) cancelBtn.onclick = null;
            dialog.oncancel = null;
            resolve(result);
        };
        if (okBtn) okBtn.onclick = () => cleanup(true);
        if (cancelBtn) cancelBtn.onclick = () => cleanup(false);
        dialog.oncancel = () => cleanup(false);
    });
}

export function showResultDialog(options: {title: string; message: string; success: boolean}): Promise<void> {
    const dialog = document.querySelector<HTMLDialogElement>('#confirm-dialog');
    const title = document.querySelector<HTMLElement>('#confirm-title');
    const message = document.querySelector<HTMLElement>('#confirm-message');
    const icon = dialog?.querySelector<HTMLElement>('.confirm-icon');
    const ok = document.querySelector<HTMLButtonElement>('#confirm-ok');
    const cancel = document.querySelector<HTMLButtonElement>('#confirm-cancel');
    if (!dialog || !title || !message || !icon || !ok || !cancel) {
        throw new Error('No se encontró el diálogo de resultados.');
    }

    title.textContent = options.title;
    message.textContent = options.message;
    icon.textContent = options.success ? '✓' : '⚠️';
    dialog.classList.toggle('result-success', options.success);
    dialog.classList.toggle('result-error', !options.success);
    cancel.hidden = true;
    ok.textContent = 'Entendido';
    ok.className = options.success ? 'primary' : 'danger primary';

    return new Promise(resolve => {
        const cleanup = () => {
            dialog.close();
            ok.onclick = null;
            dialog.oncancel = null;
            dialog.classList.remove('result-success', 'result-error');
            cancel.hidden = false;
            resolve();
        };
        ok.onclick = cleanup;
        dialog.oncancel = event => event.preventDefault();
        dialog.showModal();
        ok.focus();
    });
}

export function showDeleteDependencies(
    blockers: readonly DeleteDependencyBlocker[],
    labels: Readonly<Record<string, string>>,
): Promise<void> {
    const dialog = document.querySelector<HTMLDialogElement>('#delete-dependencies-dialog');
    const list = document.querySelector<HTMLUListElement>('#delete-dependencies-list');
    const closeButton = document.querySelector<HTMLButtonElement>('#close-delete-dependencies');
    if (!dialog || !list || !closeButton) throw new Error('No se encontró el diálogo de dependencias.');

    list.replaceChildren();
    for (const blocker of blockers) {
        const item = document.createElement('li');
        const heading = document.createElement('strong');
        heading.textContent = `${labels[blocker.entity] ?? blocker.entity} (${blocker.relationship}): ${blocker.count} fila${blocker.count === 1 ? '' : 's'}`;
        item.append(heading);
        const examples = document.createElement('ul');
        for (const key of blocker.keys) {
            const example = document.createElement('li');
            example.textContent = Object.entries(key).map(([name, value]) => `${name}: ${value ?? '(vacío)'}`).join(' · ');
            examples.append(example);
        }
        item.append(examples);
        if (blocker.count > blocker.keys.length) {
            const more = document.createElement('p');
            more.className = 'muted';
            more.textContent = `Se muestran hasta ${blocker.keys.length} claves de ${blocker.count}.`;
            item.append(more);
        }
        list.append(item);
    }

    dialog.showModal();
    return new Promise(resolve => {
        const cleanup = () => {
            dialog.close();
            closeButton.onclick = null;
            dialog.oncancel = null;
            resolve();
        };
        closeButton.onclick = cleanup;
        dialog.oncancel = cleanup;
    });
}

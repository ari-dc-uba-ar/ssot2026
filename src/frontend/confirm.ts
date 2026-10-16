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

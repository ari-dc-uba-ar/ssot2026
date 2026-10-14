import {changePassword, clearSession, generateRecoveryCodes, login, logout, recover} from './api.js';

export function initializeAuthentication(onSession: (active: boolean) => void): void {
    const panel = document.querySelector<HTMLElement>('#authentication')!;
    const loginForm = document.querySelector<HTMLFormElement>('#login-form')!;
    const recoveryForm = document.querySelector<HTMLFormElement>('#recovery-form')!;
    const session = document.querySelector<HTMLElement>('#session')!;
    const error = document.querySelector<HTMLElement>('#auth-status')!;
    const codesDialog = document.querySelector<HTMLDialogElement>('#recovery-codes')!;
    const account = document.querySelector<HTMLDialogElement>('#account')!;
    const accountForm = document.querySelector<HTMLFormElement>('#account-form')!;
    function signedOut(): void {
        clearSession();
        panel.hidden = false;
        session.hidden = true;
        account.close();
        onSession(false);
    }
    async function action(form: HTMLFormElement, work: () => Promise<void>): Promise<void> {
        const inputs = [...form.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')];
        inputs.forEach(input => { input.disabled = true; });
        error.textContent = '';
        try { await work(); }
        catch (failure) { error.textContent = failure instanceof Error ? failure.message : 'No se pudo completar la operación.'; }
        finally {
            form.querySelectorAll<HTMLInputElement>('input[type=password]').forEach(input => { input.value = ''; });
            inputs.forEach(input => { input.disabled = false; });
        }
    }
    function savedCodes(codes: string[]): Promise<void> {
        document.querySelector('#codes')!.textContent = codes.join('\n');
        codesDialog.oncancel = event => event.preventDefault();
        const download = document.querySelector<HTMLButtonElement>('#download-codes')!;
        download.onclick = () => {
            const url = URL.createObjectURL(new Blob(['SSOT2026 · Códigos de recuperación\n\n' + codes.join('\n')], {type: 'text/plain'}));
            const link = document.createElement('a');
            link.href = url;
            link.download = 'ssot2026-codigos.txt';
            link.click();
            URL.revokeObjectURL(url);
        };
        codesDialog.showModal();
        return new Promise(resolve => {
            const saved = document.querySelector<HTMLButtonElement>('#saved-codes')!;
            saved.onclick = () => {
                codesDialog.close();
                document.querySelector('#codes')!.textContent = '';
                download.onclick = null;
                saved.onclick = null;
                resolve();
            };
        });
    }
    loginForm.onsubmit = event => {
        event.preventDefault();
        const data = new FormData(loginForm);
        void action(loginForm, async () => {
            const result = await login(String(data.get('usuario')), String(data.get('contrasena')));
            loginForm.reset();
            panel.hidden = true;
            session.hidden = false;
            document.querySelector('#session-user')!.textContent = result.user.usuario;
            onSession(true);
        });
    };
    document.querySelector<HTMLButtonElement>('#show-recovery')!.onclick = () => {
        loginForm.hidden = true;
        recoveryForm.hidden = false;
        error.textContent = '';
    };
    document.querySelector<HTMLButtonElement>('#show-login')!.onclick = () => {
        loginForm.hidden = false;
        recoveryForm.hidden = true;
        recoveryForm.reset();
        error.textContent = '';
    };
    recoveryForm.onsubmit = event => {
        event.preventDefault();
        const data = new FormData(recoveryForm);
        void action(recoveryForm, async () => {
            const result = await recover(String(data.get('usuario')), String(data.get('codigo')), String(data.get('contrasena')));
            recoveryForm.reset();
            await savedCodes(result.codes);
            recoveryForm.hidden = true;
            loginForm.hidden = false;
            error.textContent = 'Contraseña recuperada. Iniciá sesión con la nueva contraseña.';
        });
    };
    document.querySelector<HTMLButtonElement>('#logout')!.onclick = () => {
        void logout().catch(() => {}).finally(signedOut);
    };
    document.querySelector<HTMLButtonElement>('#manage-account')!.onclick = () => {
        accountForm.reset();
        document.querySelector('#account-status')!.textContent = '';
        account.showModal();
    };
    document.querySelector<HTMLButtonElement>('#close-account')!.onclick = () => account.close();
    accountForm.onsubmit = event => {
        event.preventDefault();
        const data = new FormData(accountForm);
        const password = String(data.get('actual'));
        const next = String(data.get('nueva'));
        void action(accountForm, async () => {
            try {
                const result = next ? await changePassword(password, next) : await generateRecoveryCodes(password);
                account.close();
                await savedCodes(result.codes);
                if (next) signedOut();
            } catch (failure) {
                document.querySelector('#account-status')!.textContent = failure instanceof Error ? failure.message : 'No se pudo completar la operación.';
            }
        });
    };
    window.addEventListener('sessionexpired', signedOut);
    signedOut();
}

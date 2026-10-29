import {changePassword, clearSession, generateRecoveryCodes, isAuthenticated, login, logout, recover, restoreSession} from './api.js';
import type {AuthenticatedUser} from '../backend/browser-contract.js';
import {confirmAction} from './confirm.js';

export function initializeAuthentication(onSession: (active: boolean) => void): void {
    const panel = document.querySelector<HTMLElement>('#authentication')!;
    const identityForm = document.querySelector<HTMLFormElement>('#identity-form')!;
    const username = document.querySelector<HTMLInputElement>('#login-user')!;
    const loginUsername = document.querySelector<HTMLInputElement>('#login-username')!;
    const password = document.querySelector<HTMLInputElement>('#login-password')!;
    const loginForm = document.querySelector<HTMLFormElement>('#login-form')!;
    const recoveryForm = document.querySelector<HTMLFormElement>('#recovery-form')!;
    const session = document.querySelector<HTMLElement>('#session')!;
    const error = document.querySelector<HTMLElement>('#auth-status')!;
    const codesDialog = document.querySelector<HTMLDialogElement>('#recovery-codes')!;
    const account = document.querySelector<HTMLDialogElement>('#account')!;
    const accountForm = document.querySelector<HTMLFormElement>('#account-form')!;
    const accountManagement = document.querySelector<HTMLElement>('#account-management');
    const accountTitle = document.querySelector<HTMLElement>('#account-dialog-title');
    const closeAccountDialog = document.querySelector<HTMLButtonElement>('#close-account-dialog');

    function showStep(step: 'identity' | 'password' | 'recovery'): void {
        identityForm.hidden = step !== 'identity';
        loginForm.hidden = step !== 'password';
        recoveryForm.hidden = step !== 'recovery';
        password.value = '';
        error.textContent = '';
        document.querySelector('#authentication-title')!.textContent = step === 'recovery' ? 'Recuperar contraseña' : 'Iniciar sesión';
        const focus = step === 'identity' ? username : step === 'password' ? password : document.querySelector<HTMLInputElement>('#recover-user')!;
        focus.focus();
    }

    function signedOut(): void {
        clearSession();
        panel.hidden = false;
        if (accountManagement) accountManagement.hidden = true;
        session.hidden = true;
        account.close();
        identityForm.reset();
        loginForm.reset();
        recoveryForm.reset();
        onSession(false);
        showStep('identity');
    }

    function signedIn(user: AuthenticatedUser): void {
        loginForm.reset();
        panel.hidden = true;
        session.hidden = false;
        document.querySelector('#session-user')!.textContent = user.usuario;
        account.close();
        onSession(true);
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
            if (form === loginForm && !panel.hidden && !form.hidden) password.focus();
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

    if (closeAccountDialog) closeAccountDialog.onclick = () => account.close();

    identityForm.onsubmit = event => {
        event.preventDefault();
        loginUsername.value = username.value;
        document.querySelector('#login-identity')!.textContent = username.value;
        showStep('password');
    };
    document.querySelector<HTMLButtonElement>('#change-identity')!.onclick = () => showStep('identity');

    loginForm.onsubmit = event => {
        event.preventDefault();
        const data = new FormData(loginForm);
        void action(loginForm, async () => {
            const result = await login(String(data.get('usuario')), String(data.get('contrasena')));
            signedIn(result.user);
        });
    };

    document.querySelector<HTMLButtonElement>('#show-recovery')!.onclick = () => {
        document.querySelector<HTMLInputElement>('#recover-user')!.value = username.value;
        showStep('recovery');
    };

    document.querySelector<HTMLButtonElement>('#show-login')!.onclick = () => {
        recoveryForm.reset();
        showStep('password');
    };

    recoveryForm.onsubmit = event => {
        event.preventDefault();
        const data = new FormData(recoveryForm);
        void action(recoveryForm, async () => {
            const result = await recover(String(data.get('usuario')), String(data.get('codigo')), String(data.get('contrasena')));
            recoveryForm.reset();
            await savedCodes(result.codes);
            showStep('identity');
            error.textContent = 'Contraseña recuperada. Iniciá sesión con la nueva contraseña.';
        });
    };

    document.querySelector<HTMLButtonElement>('#logout')!.onclick = async () => {
        const ok = await confirmAction({
            title: 'Cerrar sesión',
            message: '¿Estás seguro de que deseas cerrar tu sesión actual?',
            confirmText: 'Cerrar sesión',
            danger: true,
        });
        if (!ok) return;
        void logout().catch(() => {}).finally(() => {
            signedOut();
        });
    };

    document.querySelector<HTMLButtonElement>('#manage-account')!.onclick = () => {
        accountForm.reset();
        document.querySelector('#account-status')!.textContent = '';
        panel.hidden = true;
        if (accountManagement) accountManagement.hidden = false;
        const user = document.querySelector('#session-user')?.textContent;
        if (accountTitle) accountTitle.textContent = user ? `Mi cuenta · ${user}` : 'Mi cuenta';
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
                if (next) {
                    signedOut();
                }
            } catch (failure) {
                document.querySelector('#account-status')!.textContent = failure instanceof Error ? failure.message : 'No se pudo completar la operación.';
            }
        });
    };

    window.addEventListener('sessionexpired', () => {
        signedOut();
    });

    if (!isAuthenticated()) signedOut();
    else {
        panel.hidden = true;
        const status = document.querySelector<HTMLElement>('#status')!;
        status.textContent = 'Restaurando sesión…';
        void restoreSession().then(user => {
            if (user) signedIn(user);
            else signedOut();
        }).catch(() => {
            panel.hidden = false;
            showStep('identity');
            error.textContent = 'No se pudo recuperar la sesión. Volvé a cargar la página para reintentar.';
        }).finally(() => {
            if (status.textContent === 'Restaurando sesión…') status.textContent = '';
        });
    }
}

import type {ApiError, AuthenticatedUser, DeleteDependencyCheck, EntityCreate, EntityKey, EntityName, EntityNamesResponse, EntityResponse, EntityUpdate, LoginResponse, RecoveryCodesResponse} from '../backend/browser-contract.js';
import type {Problem} from 'system-definition';
import type {EntityName as ChangedEntity, EntityQuery} from '../backend/browser-contract.js';
import {messageOf} from './messages.js';

export class ApiRequestError extends Error {
    readonly problems: readonly Problem[];
    constructor(message: string, problems: readonly Problem[] = []) {
        super(problems.length ? problems.map(problem => messageOf(problem)).join(' ') : message);
        this.problems = problems;
    }
}

const sessionKey = 'ssot-session-token';
let token: string | undefined;
try { token = sessionStorage.getItem(sessionKey) ?? undefined; } catch {}
function storeToken(value: string | undefined): void {
    token = value;
    try {
        if (value) sessionStorage.setItem(sessionKey, value);
        else sessionStorage.removeItem(sessionKey);
    } catch {} // Memory-only login still works when browser storage is unavailable.
}
export const isAuthenticated = (): boolean => token !== undefined;
export function clearSession(): void { storeToken(undefined); }

async function request(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<Response> {
    const requestToken = token;
    const response = await fetch(path, {
        method,
        headers: {'Content-Type': 'application/json', ...(requestToken ? {Authorization: `Bearer ${requestToken}`} : {})},
        cache: 'no-store',
        ...(signal ? {signal} : {}),
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    if (!response.ok) {
        if (response.status === 401 && token === requestToken && (path.startsWith('/api/entities') || path === '/api/events' || path === '/api/auth/me')) {
            clearSession();
            window.dispatchEvent(new Event('sessionexpired'));
        }
        const error = await response.json() as ApiError;
        throw new ApiRequestError(error.error, error.problems ?? []);
    }
    return response;
}

const path = (name: EntityName) => `/api/entities/${encodeURIComponent(name)}`;
export async function listEntities(): Promise<EntityNamesResponse> {
    return (await request('/api/entities')).json() as Promise<EntityNamesResponse>;
}
export async function loadEntity(name: EntityName, query?: EntityQuery): Promise<EntityResponse> {
    return (await request(`${path(name)}?query=${encodeURIComponent(JSON.stringify(query ?? {}))}`)).json() as Promise<EntityResponse>;
}

export function watchEntities(changed: (name: ChangedEntity | null) => void): () => void {
    const controller = new AbortController();
    // A data request can fail while the event connection itself survives a short outage.
    window.addEventListener('online', () => changed(null), {signal: controller.signal});
    void (async () => {
        while (!controller.signal.aborted && isAuthenticated()) {
            try {
                const response = await request('/api/events', 'GET', undefined, controller.signal);
                const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
                let pending = '';
                try {
                    while (!controller.signal.aborted) {
                        const {done, value} = await reader.read();
                        if (done) break;
                        pending += value;
                        let end: number;
                        while ((end = pending.indexOf('\n')) >= 0) {
                            const line = pending.slice(0, end);
                            pending = pending.slice(end + 1);
                            if (line.startsWith('data: ')) changed(JSON.parse(line.slice(6)) as ChangedEntity | null);
                        }
                    }
                } finally { reader.releaseLock(); }
            } catch {
                if (controller.signal.aborted || !isAuthenticated()) return;
            }
            // Transport reconnect delay, not a data freshness interval.
            await new Promise<void>(resolve => {
                const cancel = () => { clearTimeout(timer); resolve(); };
                const timer = setTimeout(() => { controller.signal.removeEventListener('abort', cancel); resolve(); }, 1000);
                controller.signal.addEventListener('abort', cancel, {once: true});
            });
        }
    })();
    return () => controller.abort();
}
export async function createRow(name: EntityName, row: EntityCreate): Promise<void> {
    await request(path(name), 'POST', row);
}
export async function updateRow(name: EntityName, update: EntityUpdate): Promise<void> {
    await request(path(name), 'PUT', update);
}
export async function deleteRow(name: EntityName, key: EntityKey): Promise<void> {
    await request(path(name), 'DELETE', key);
}
export async function checkDeleteDependencies(name: EntityName, keys: EntityKey[]): Promise<DeleteDependencyCheck> {
    return (await request(`${path(name)}/delete-check`, 'POST', {keys})).json() as Promise<DeleteDependencyCheck>;
}
export async function deleteRows(name: EntityName, keys: EntityKey[]): Promise<void> {
    await request(`${path(name)}/bulk-delete`, 'POST', {keys});
}

export async function login(usuario: string, contrasena: string): Promise<LoginResponse> {
    const session = await (await request('/api/auth/login', 'POST', {usuario, contrasena})).json() as LoginResponse;
    storeToken(session.token);
    return session;
}
export async function restoreSession(): Promise<AuthenticatedUser | undefined> {
    if (!token) return undefined;
    try { return (await request('/api/auth/me')).json() as Promise<AuthenticatedUser>; }
    catch (error) { if (!token) return undefined; throw error; }
}
export async function logout(): Promise<void> {
    const pending = request('/api/auth/logout', 'POST', {});
    clearSession();
    await pending;
}
export async function recover(usuario: string, codigo: string, contrasena: string): Promise<RecoveryCodesResponse> {
    return (await request('/api/auth/recover', 'POST', {usuario, codigo, contrasena})).json() as Promise<RecoveryCodesResponse>;
}
export async function generateRecoveryCodes(contrasena: string): Promise<RecoveryCodesResponse> {
    return (await request('/api/auth/recovery-codes', 'POST', {contrasena})).json() as Promise<RecoveryCodesResponse>;
}
export async function changePassword(contrasenaActual: string, contrasena: string): Promise<RecoveryCodesResponse> {
    const response = await request('/api/auth/password', 'POST', {contrasenaActual, contrasena});
    clearSession();
    return response.json() as Promise<RecoveryCodesResponse>;
}

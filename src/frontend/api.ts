import type {ApiError, DeleteDependencyCheck, EntityCreate, EntityKey, EntityName, EntityNamesResponse, EntityResponse, EntityUpdate, LoginResponse, RecoveryCodesResponse} from '../backend/api-contract.js';
import type {Problem} from 'system-definition';

export class ApiRequestError extends Error {
    readonly problems: readonly Problem[];
    constructor(message: string, problems: readonly Problem[] = []) {
        super(message);
        this.problems = problems;
    }
}

let token: string | undefined;
export const isAuthenticated = (): boolean => token !== undefined;
export function clearSession(): void { token = undefined; }

async function request(path: string, method = 'GET', body?: unknown): Promise<Response> {
    const response = await fetch(path, {
        method,
        headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
        cache: 'no-store',
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    if (!response.ok) {
        if (response.status === 401 && (path.startsWith('/api/entities') || path === '/api/auth/me')) {
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
export async function loadEntity<E extends EntityName>(name: E): Promise<EntityResponse<E>> {
    return (await request(path(name))).json() as Promise<EntityResponse<E>>;
}
export async function createRow<E extends EntityName>(name: E, row: EntityCreate<NoInfer<E>>): Promise<void> {
    await request(path(name), 'POST', row);
}
export async function updateRow<E extends EntityName>(name: E, update: EntityUpdate<NoInfer<E>>): Promise<void> {
    await request(path(name), 'PUT', update);
}
export async function deleteRow<E extends EntityName>(name: E, key: EntityKey<NoInfer<E>>): Promise<void> {
    await request(path(name), 'DELETE', key);
}
export async function checkDeleteDependencies<E extends EntityName>(name: E, keys: EntityKey<NoInfer<E>>[]): Promise<DeleteDependencyCheck> {
    return (await request(`${path(name)}/delete-check`, 'POST', {keys})).json() as Promise<DeleteDependencyCheck>;
}
export async function deleteRows<E extends EntityName>(name: E, keys: EntityKey<NoInfer<E>>[]): Promise<void> {
    await request(`${path(name)}/bulk-delete`, 'POST', {keys});
}

export async function login(usuario: string, contrasena: string): Promise<LoginResponse> {
    const session = await (await request('/api/auth/login', 'POST', {usuario, contrasena})).json() as LoginResponse;
    token = session.token;
    return session;
}
export async function logout(): Promise<void> {
    try { await request('/api/auth/logout', 'POST', {}); }
    finally { clearSession(); }
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

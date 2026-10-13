import type {ApiError, EntityKey, EntityName, EntityNamesResponse, EntityResponse, EntityRow, EntityUpdate} from '../backend/api-contract.js';

async function request(path: string, method = 'GET', body?: unknown): Promise<Response> {
    const response = await fetch(path, {
        method,
        headers: {'Content-Type': 'application/json'},
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    if (!response.ok) {
        const error = await response.json() as ApiError;
        throw new Error(error.error);
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
export async function createRow<E extends EntityName>(name: E, row: EntityRow<NoInfer<E>>): Promise<void> {
    await request(path(name), 'POST', row);
}
export async function updateRow<E extends EntityName>(name: E, update: EntityUpdate<NoInfer<E>>): Promise<void> {
    await request(path(name), 'PUT', update);
}
export async function deleteRow<E extends EntityName>(name: E, key: EntityKey<NoInfer<E>>): Promise<void> {
    await request(path(name), 'DELETE', key);
}

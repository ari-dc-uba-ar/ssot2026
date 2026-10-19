import type {EntityName, EntityQuery, EntityResponse} from '../backend/api-contract.js';
import {loadEntity} from './api.js';

// One reusable dataset (or most recent page) per entity, including in-flight loads.
export function createEntityCache(fetchEntity = loadEntity) {
    type Entry = {name: EntityName; key: string; pending: Promise<EntityResponse>; value?: EntityResponse};
    const entries = new Map<EntityName, Entry>();
    const pending = new Map<string, Entry>();
    const revisions = new Map<EntityName, number>();
    let session = 0;
    return {
        async load(name: EntityName, query: EntityQuery = {}): Promise<EntityResponse> {
            const key = JSON.stringify([name, query.filter ?? '', query.sort ?? '', query.direction ?? 'asc', query.page ?? 1,
                Object.entries(query.where ?? {}).sort()]);
            const previous = entries.get(name);
            if (previous?.value?.window.kind === 'complete') return previous.value;
            if (previous?.key === key) return previous.pending;
            if (pending.has(key)) return pending.get(key)!.pending;
            const generation = session;
            const revision = revisions.get(name);
            const entry: Entry = {name, key, pending: Promise.resolve().then(async () => {
                const value = await fetchEntity(name, query);
                if (generation !== session || revision !== revisions.get(name)) throw new DOMException('Obsolete response', 'AbortError');
                entry.value = value;
                return value;
            })};
            entries.set(name, entry);
            pending.set(key, entry);
            try {
                return await entry.pending;
            } catch (error) {
                if (entries.get(name) === entry) entries.delete(name);
                throw error;
            } finally {
                if (pending.get(key) === entry) pending.delete(key);
            }
        },
        invalidate(name: EntityName | null): void {
            if (name === null) { session++; entries.clear(); pending.clear(); return; }
            revisions.set(name, (revisions.get(name) ?? 0) + 1);
            entries.delete(name);
            for (const [key, entry] of pending) if (entry.name === name) pending.delete(key);
        },
        clear(): void { session++; entries.clear(); pending.clear(); revisions.clear(); },
    };
}

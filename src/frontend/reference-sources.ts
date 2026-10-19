import type {EntityForeignKey, EntityName, EntityResponse, EntityQuery} from '../backend/api-contract.js';
import {loadEntity} from './api.js';
import type {ReferenceSource} from './foreign-keys.js';
export type LoadedReferenceSource = ReferenceSource & {reference: EntityForeignKey; target: EntityResponse;
    load: (query: EntityQuery) => Promise<EntityResponse>};

export async function loadReferenceSources(references: readonly EntityForeignKey[],
    load: (name: EntityName, query?: EntityQuery) => Promise<EntityResponse> = loadEntity): Promise<LoadedReferenceSource[]> {
    const targets = new Map<EntityName, Promise<EntityResponse>>();
    const visited = new Set<string>();
    const visit = async (reference: EntityForeignKey): Promise<LoadedReferenceSource[]> => {
        const identity = JSON.stringify([reference.entity, Object.entries(reference.fields).sort(([left], [right]) => left.localeCompare(right))]);
        if (visited.has(identity)) return [];
        visited.add(identity);
        if (!targets.has(reference.entity)) targets.set(reference.entity, load(reference.entity));
        const target = await targets.get(reference.entity)!;
        const sourceNames = new Map<string, string>(Object.entries(reference.fields).map(([source, destination]) => [destination, source]));
        const parents = await Promise.all(target.foreignKeys.flatMap(parent => {
            const pairs = Object.entries(parent.fields);
            if (!pairs.every(([source]) => sourceNames.has(source))) return [];
            return [visit({...parent, fields: Object.fromEntries(pairs.map(([source, destination]) => [sourceNames.get(source)!, destination]))} as EntityForeignKey)];
        }));
        return [{reference, rows: target.rows, target, load: query => load(reference.entity, query)}, ...parents.flat()];
    };
    return (await Promise.all(references.map(visit))).flat();
}

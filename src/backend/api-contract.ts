// Browser consumers import these types only; domain definitions stay in the backend.
import type {EntityInfoOf, EntityInstanceType} from 'system-definition';
import type {myRecords, myEntities} from './system.js';

export type EntityName = keyof typeof myEntities;
export type EntityNamesResponse = EntityName[];
export type EntityRow<E extends EntityName> = E extends EntityName
    ? EntityInstanceType<typeof myRecords, (typeof myEntities)[E]> : never;

type Fields<E extends EntityName> = EntityInfoOf<typeof myRecords, (typeof myEntities)[E]>['fields'];
type DisplayColumn<T> = T extends {name: string; label: string; type: string; nullable: boolean}
    ? Pick<T, 'name' | 'label' | 'type' | 'nullable'> : never;
export type EntityColumn<E extends EntityName> = E extends EntityName
    ? DisplayColumn<Fields<E>[keyof Fields<E>]> : never;

export type EntityResponse<E extends EntityName = EntityName> = E extends EntityName ? {
    name: E;
    pk: (typeof myEntities)[E]['pk'];
    columns: EntityColumn<E>[];
    rows: EntityRow<E>[];
} : never;
export type EntityKey<E extends EntityName> = E extends EntityName
    ? Pick<EntityRow<E>, (typeof myEntities)[E]['pk'][number] & keyof EntityRow<E>> : never;
export type EntityUpdate<E extends EntityName> = E extends EntityName ? {
    key: EntityKey<E>;
    row: EntityRow<E>;
} : never;
export type ApiError = {error: string};

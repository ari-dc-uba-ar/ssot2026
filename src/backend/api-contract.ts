// Browser consumers import these types only; domain definitions stay in the backend.
import type {EntityInfoOf, EntityInstanceType} from 'system-definition';
import type {myRecords, myEntities} from './system.js';

export type EntityName = keyof typeof myEntities;
export type EntityNamesResponse = EntityName[];
export type EntityRow<E extends EntityName> = E extends EntityName
    ? EntityInstanceType<typeof myRecords, (typeof myEntities)[E]> : never;

type Fields<E extends EntityName> = EntityInfoOf<typeof myRecords, (typeof myEntities)[E]>['fields'];
type DisplayColumn<T> = T extends {name: string; label: string; type: string}
    ? Pick<T, 'name' | 'label' | 'type'> : never;
export type EntityColumn<E extends EntityName> = E extends EntityName
    ? DisplayColumn<Fields<E>[keyof Fields<E>]> : never;

export type EntityResponse<E extends EntityName = EntityName> = E extends EntityName ? {
    name: E;
    columns: EntityColumn<E>[];
    rows: EntityRow<E>[];
} : never;
export type ApiError = {error: string};

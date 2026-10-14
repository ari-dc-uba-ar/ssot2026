// Browser consumers import these types only; domain definitions stay in the backend.
import type {EntityInfoOf, EntityInstanceType, Problem} from 'system-definition';
import type {myRecords, myEntities} from './system.js';

export type EntityName = keyof typeof myEntities;
export type EntityNamesResponse = EntityName[];
type StoredRow<E extends EntityName> = EntityInstanceType<typeof myRecords, (typeof myEntities)[E]>;
type AllowedNames<E extends EntityName, P extends 'readable' | 'writable'> = {
    [K in keyof (typeof myEntities)[E]['fields']]: (typeof myEntities)[E]['fields'][K] extends Record<P, false> ? never : K
}[keyof (typeof myEntities)[E]['fields']] & keyof StoredRow<E>;
export type EntityRow<E extends EntityName> = E extends EntityName ? Pick<StoredRow<E>, AllowedNames<E, 'readable'>> : never;
export type EntityInput<E extends EntityName> = E extends EntityName
    ? Pick<StoredRow<E>, AllowedNames<E, 'writable'>> & (E extends 'usuarios' ? {contrasena?: string} : {}) : never;
export type EntityCreate<E extends EntityName> = E extends 'usuarios' ? EntityInput<E> & {contrasena: string} : EntityInput<E>;

type Fields<E extends EntityName> = EntityInfoOf<typeof myRecords, (typeof myEntities)[E]>['fields'];
type DisplayColumn<T> = T extends {name: string; label: string; type: string; nullable: boolean}
    ? Pick<T, 'name' | 'label' | 'type' | 'nullable'> & {writable: boolean} : never;
export type EntityColumn<E extends EntityName> = E extends EntityName
    ? DisplayColumn<Fields<E>[AllowedNames<E, 'readable'> & keyof Fields<E>]> : never;

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
    row: EntityInput<E>;
} : never;
export type ApiError = {error: string; problems?: readonly Problem[]};
export type AuthenticatedUser = {id: string; usuario: string; administrador: boolean};
export type LoginResponse = {token: string; expiresIn: number; user: AuthenticatedUser};
export type RecoveryCodesResponse = {codes: string[]};

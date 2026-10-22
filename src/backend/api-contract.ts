// Backend-only specialization of the public protocol using the concrete SSOT.
import type {EntityInfoOf, EntityInstanceType} from 'system-definition';
import type {myRecords, myEntities} from './system.js';
import type {InputConstraints} from './value-types.js';
import type {EntityResponse as BrowserEntityResponse} from './browser-contract.js';
export type {EntityWindow, ApiError, AuthenticatedUser, LoginResponse, RecoveryCodesResponse} from './browser-contract.js';

export type EntityName = keyof typeof myEntities;
export type EntityNamesResponse = {name: EntityName; label: string}[];
export type EntityQuery<E extends EntityName = EntityName> = E extends EntityName ? {
    filter?: string; sort?: keyof EntityRow<E> & string; direction?: 'asc' | 'desc'; page?: number;
    where?: Readonly<Partial<EntityRow<E>>>;
} : never;
type StoredRow<E extends EntityName> = EntityInstanceType<typeof myRecords, (typeof myEntities)[E]>;
type Definitions<E extends EntityName> = (typeof myEntities)[E]['fields'];
type AllowedNames<E extends EntityName, P extends 'readable' | 'writable' | 'visible'> = {
    [K in keyof (typeof myEntities)[E]['fields']]: (typeof myEntities)[E]['fields'][K] extends Record<P, false> ? never : K
}[keyof (typeof myEntities)[E]['fields']] & keyof StoredRow<E>;
export type EntityRow<E extends EntityName> = E extends EntityName ? Pick<StoredRow<E>, AllowedNames<E, 'readable'>> : never;
type InputName<E extends EntityName, K extends keyof Definitions<E>> = Definitions<E>[K] extends {inputName: infer N extends string} ? N : K;
type InputFields<E extends EntityName> = {
    [K in AllowedNames<E, 'writable'> as InputName<E, K>]: StoredRow<E>[K]
};
type OptionalInputs<E extends EntityName> = {
    [K in AllowedNames<E, 'writable'>]: Definitions<E>[K] extends {transform: 'password'} ? InputName<E, K> : never
}[AllowedNames<E, 'writable'>] & keyof InputFields<E>;
export type EntityInput<E extends EntityName> = E extends EntityName
    ? Omit<InputFields<E>, OptionalInputs<E>> & Partial<Pick<InputFields<E>, OptionalInputs<E>>> : never;
export type EntityCreate<E extends EntityName> = E extends EntityName ? InputFields<E> : never;

type Fields<E extends EntityName> = EntityInfoOf<typeof myRecords, (typeof myEntities)[E]>['fields'];
type DisplayColumn<T> = T extends {name: string; label: string; type: string; nullable: boolean}
    ? Pick<T, 'name' | 'label' | 'type' | 'nullable'> & {writable: boolean; constraints: InputConstraints} : never;
export type EntityColumn<E extends EntityName> = E extends EntityName
    ? DisplayColumn<Fields<E>[AllowedNames<E, 'readable'> & AllowedNames<E, 'visible'> & keyof Fields<E>]> : never;
type InputColumn<T, N, D> = T extends {label: string; type: string; nullable: boolean}
    ? Pick<T, 'label' | 'nullable'> & {name: N; type: D extends {inputType: infer I} ? I : T['type'];
        constraints: InputConstraints; optionalOnUpdate: boolean} : never;
export type EntityInputColumn<E extends EntityName> = E extends EntityName ? {
    [K in AllowedNames<E, 'writable'>]: InputColumn<Fields<E>[K & keyof Fields<E>], InputName<E, K>, Definitions<E>[K]>
}[AllowedNames<E, 'writable'>] : never;

export type EntityForeignKey = {
    [E in EntityName]: {
        name: string;
        entity: E;
        fields: Readonly<Record<string, keyof EntityRow<E> & string>>;
        displayFields: readonly (keyof EntityRow<E> & string)[];
    }
}[EntityName];

export type EntityResponse<E extends EntityName = EntityName> = E extends EntityName ? Pick<BrowserEntityResponse, 'label' | 'browsing' | 'versions' | 'window'> & {
    name: E;
    pk: (typeof myEntities)[E]['pk'];
    columns: EntityColumn<E>[];
    inputs: EntityInputColumn<E>[];
    foreignKeys: EntityForeignKey[];
    rows: EntityRow<E>[];
} : never;
export type EntityKey<E extends EntityName> = E extends EntityName
    ? Pick<EntityRow<E>, (typeof myEntities)[E]['pk'][number] & keyof EntityRow<E>> : never;
export type DeleteDependencyBlocker = {
    [E in EntityName]: {
        entity: E;
        relationship: string;
        count: number;
        keys: EntityKey<E>[];
    }
}[EntityName];
export type DeleteDependencyCheck = {blockers: DeleteDependencyBlocker[]};
export type EntityUpdate<E extends EntityName> = E extends EntityName ? {
    key: EntityKey<E>;
    row: EntityInput<E>;
    version: string;
} : never;

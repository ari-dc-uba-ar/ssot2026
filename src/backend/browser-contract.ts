// Public protocol: table names and field names are discovered through the API.
import type {Problem} from 'system-definition';
import type {appTypeDefs, InputConstraints} from './value-types.js';

export type EntityName = string;
export type FieldType = keyof typeof appTypeDefs;
export type FieldValue = (typeof appTypeDefs)[FieldType]['tsType'] | null;
export type EntityRow = Record<string, FieldValue>;
export type EntityKey = Record<string, NonNullable<FieldValue>>;
export type EntityCreate = EntityRow;
export type EntityInput = EntityRow;
export type EntityUpdate = {key: EntityKey; row: EntityInput; version: string};
export type EntityNamesResponse = {name: EntityName; label: string}[];
export type EntityQuery = {
    filter?: string; sort?: string; direction?: 'asc' | 'desc'; page?: number;
    where?: Readonly<Partial<EntityRow>>;
};
export type EntityWindow = {kind: 'complete'} | {kind: 'page'; total: number; matched: number; page: number};
export type EntityColumn = {name: string; label: string; type: FieldType; nullable: boolean; writable: boolean; constraints: InputConstraints};
export type EntityInputColumn = Omit<EntityColumn, 'writable'> & {optionalOnUpdate: boolean};
export type EntityForeignKey = {name: string; entity: EntityName; fields: Readonly<Record<string, string>>; displayFields: readonly string[]};
export type EntityResponse = {
    name: EntityName;
    label: string;
    browsing: {clientRows: number; pageSize: number; bulkDeleteLimit: number};
    pk: readonly string[];
    columns: EntityColumn[];
    inputs: EntityInputColumn[];
    foreignKeys: EntityForeignKey[];
    rows: EntityRow[];
    versions: string[];
    window: EntityWindow;
};
export type DeleteDependencyBlocker = {entity: EntityName; relationship: string; count: number; keys: EntityKey[]};
export type DeleteDependencyCheck = {blockers: DeleteDependencyBlocker[]};
export type ApiError = {error: string; problems?: readonly Problem[]};
export type AuthenticatedUser = {id: string; usuario: string};
export type LoginResponse = {token: string; expiresIn: number; user: AuthenticatedUser};
export type RecoveryCodesResponse = {codes: string[]};

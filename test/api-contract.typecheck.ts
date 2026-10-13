import type {EntityColumn, EntityKey, EntityResponse, EntityRow} from '../src/backend/api-contract.js';
import {createRow, deleteRow, updateRow} from '../src/frontend/api.js';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
export type RequiredPrimaryKey = Assert<Equal<EntityRow<'materias'>['materia'], string>>;
export type NullableText = Assert<Equal<EntityRow<'materias'>['cod_mat'], string | null>>;
export type NullableBoolean = Assert<Equal<EntityRow<'materias'>['obligatoria'], boolean | null>>;
export type NullableInteger = Assert<Equal<EntityRow<'pabellones'>['pisos'], number | null>>;
export type ColumnLiteral = Assert<Equal<Extract<EntityColumn<'materias'>, {name: 'obligatoria'}>['type'], 'boolean'>>;
export type MinimumMetadata = Assert<Equal<keyof EntityColumn<'materias'>, 'name' | 'label' | 'type' | 'nullable'>>;
export type PrimaryKey = Assert<Equal<keyof EntityKey<'materias'>, 'materia'>>;
export type EntityAndRowsStayTogether = Assert<Equal<Extract<EntityResponse, {name: 'pabellones'}>['rows'][number], EntityRow<'pabellones'>>>;
// @ts-expect-error Entity names come from the SSOT.
export type UnknownEntity = EntityRow<'users'>;
// @ts-expect-error Fields cannot be taken from another entity.
export type WrongField = EntityRow<'materias'>['pisos'];
// @ts-expect-error Storage and validation metadata are not in the browser contract.
export type HiddenMetadata = EntityColumn<'materias'>['validators'];
// @ts-expect-error The entity primary key is required.
export const nullKey: EntityRow<'materias'>['materia'] = null;
// @ts-expect-error Boolean values cannot be strings.
export const stringBoolean: EntityRow<'materias'>['obligatoria'] = 'true';

void createRow('planes', {plan: 1, descripcion: null});
void updateRow('planes', {key: {plan: 1}, row: {plan: 2, descripcion: 'Changed key'}});
// @ts-expect-error The API client preserves each entity's row type.
void createRow('planes', {materia: 'Wrong entity'});
// @ts-expect-error Deletion requires the selected entity's primary key.
void deleteRow('planes', {materia: 'Wrong key'});
// @ts-expect-error A key cannot be null.
void deleteRow('planes', {plan: null});

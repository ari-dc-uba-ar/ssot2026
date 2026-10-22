import type {DeleteDependencyBlocker, EntityColumn, EntityCreate, EntityForeignKey, EntityInput, EntityKey, EntityResponse, EntityRow, EntityQuery} from '../src/backend/api-contract.js';
import {checkDeleteDependencies, createRow, deleteRow, deleteRows, updateRow, loadEntity} from '../src/frontend/api.js';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
export type BackendFitsBrowser = Assert<EntityResponse extends import('../src/backend/browser-contract.js').EntityResponse ? true : false>;
export type RequiredPrimaryKey = Assert<Equal<EntityRow<'materias'>['cod_mat'], string>>;
export type RequiredDepartmentKey = Assert<Equal<EntityRow<'materias'>['cod_dep'], string>>;
export type NullableText = Assert<Equal<EntityRow<'materias'>['materia'], string | null>>;
export type NullableBoolean = Assert<Equal<EntityRow<'materias'>['obligatoria'], boolean | null>>;
export type NullableInteger = Assert<Equal<EntityRow<'pabellones'>['pisos'], number | null>>;
export type ColumnLiteral = Assert<Equal<Extract<EntityColumn<'materias'>, {name: 'obligatoria'}>['type'], 'boolean'>>;
export type MinimumMetadata = Assert<Equal<keyof EntityColumn<'materias'>, 'name' | 'label' | 'type' | 'nullable' | 'writable' | 'constraints'>>;
export type PrimaryKey = Assert<Equal<keyof EntityKey<'materias'>, 'cod_mat' | 'cod_dep'>>;
export type EnrollmentPrimaryKey = Assert<Equal<keyof EntityKey<'enrolamientos'>, 'legajo' | 'cod_mat' | 'cod_dep' | 'año' | 'cuatrimestre'>>;
export type EnrollmentYear = Assert<Equal<EntityRow<'enrolamientos'>['año'], number>>;
export type EnrollmentRegularidad = Assert<Equal<EntityRow<'enrolamientos'>['regularidad'], 'Libre' | 'Regular' | null>>;
export type EnrollmentCuatrimestre = Assert<Equal<EntityRow<'enrolamientos'>['cuatrimestre'], '1C' | '2C'>>;
// @ts-expect-error Enum values preserve the SSOT's exact spelling.
export const invalidRegularidad: EntityRow<'enrolamientos'>['regularidad'] = 'libre';
// @ts-expect-error Cuatrimestre is a literal enum, not a numeric index.
export const invalidCuatrimestre: EntityRow<'enrolamientos'>['cuatrimestre'] = 1;
export type EntityAndRowsStayTogether = Assert<Equal<Extract<EntityResponse, {name: 'pabellones'}>['rows'][number], EntityRow<'pabellones'>>>;
export type DependencyKeysStayWithEntity = Assert<Equal<Extract<DeleteDependencyBlocker, {entity: 'materias'}>['keys'][number], EntityKey<'materias'>>>;
export const planReference: EntityForeignKey = {name: 'plan', entity: 'planes', fields: {plan: 'plan'}, displayFields: ['plan', 'descripcion']};
// @ts-expect-error Reference labels cannot expose private password hashes.
export const secretReference: EntityForeignKey = {name: 'user', entity: 'usuarios', fields: {user: 'id'}, displayFields: ['contrasena_hash']};
// @ts-expect-error Entity names come from the SSOT.
export type UnknownEntity = EntityRow<'users'>;
// @ts-expect-error Fields cannot be taken from another entity.
export type WrongField = EntityRow<'materias'>['pisos'];
// @ts-expect-error Storage and validation metadata are not in the browser contract.
export type HiddenMetadata = EntityColumn<'materias'>['validators'];
// @ts-expect-error The entity primary key is required.
export const nullKey: EntityRow<'materias'>['cod_mat'] = null;
// @ts-expect-error Boolean values cannot be strings.
export const stringBoolean: EntityRow<'materias'>['obligatoria'] = 'true';

// The browser accepts names discovered at runtime, including new backend entities.
void createRow('a-new-table', {new_field: 'value'});
void loadEntity('a-new-table', {sort: 'new_field', where: {new_field: 1}});
void updateRow('a-new-table', {key: {new_key: 1}, version: '1', row: {new_field: true}});
// @ts-expect-error Updating still requires the version originally read.
void updateRow('a-new-table', {key: {new_key: 1}, row: {new_field: true}});
// @ts-expect-error Values must belong to the SSOT's supported value types.
void createRow('a-new-table', {new_field: {arbitrary: 'object'}});
// @ts-expect-error Primary keys cannot be null.
void deleteRow('a-new-table', {new_key: null});
void deleteRows('a-new-table', [{new_key: 1}]);
void checkDeleteDependencies('a-new-table', [{new_key: 1}]);
// Backend authoring retains the concrete SSOT constraints.
// @ts-expect-error Query columns belong to the selected entity.
export const wrongSort: EntityQuery<'planes'> = {sort: 'usuario'};
// @ts-expect-error Equality filters preserve SSOT value types.
export const wrongFilter: EntityQuery<'planes'> = {where: {plan: '1'}};
// @ts-expect-error Bulk keys require every component.
export const incompleteKey: EntityKey<'materias'> = {cod_mat: 'ALG'};

export type PublicUserFields = Assert<Equal<keyof EntityRow<'usuarios'>, 'id' | 'usuario'>>;
export type PublicUserColumns = Assert<Equal<EntityColumn<'usuarios'>['name'], 'usuario'>>;
export type WritableUserFields = Assert<Equal<keyof EntityInput<'usuarios'>, 'usuario' | 'contrasena'>>;
// @ts-expect-error Password hashes cannot be read through the public API.
export type HiddenPassword = EntityRow<'usuarios'>['contrasena_hash'];
// @ts-expect-error A password is required when creating a user.
export const missingPassword: EntityCreate<'usuarios'> = {usuario: 'usuario'};
// @ts-expect-error Recovery hashes cannot be assigned through the public API.
export const privateInput: EntityCreate<'usuarios'> = {usuario: 'usuario', contrasena: 'a-long-password', recuperacion_hashes: '[]'};
void createRow('usuarios', {usuario: 'usuario', contrasena: 'a-long-password'});
void updateRow('usuarios', {key: {id: 'id'}, version: '1', row: {usuario: 'usuario'}});
// @ts-expect-error There are no per-account roles.
export const roleInput: EntityCreate<'usuarios'> = {usuario: 'usuario', contrasena: 'a-long-password', administrador: true};

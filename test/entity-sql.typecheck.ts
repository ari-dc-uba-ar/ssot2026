import type {Pool} from 'pg';
import {entitySql} from '../src/backend/entity-sql.js';
import type {StoredRow} from '../src/backend/api-contract.js';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
declare const db: Pool;

const users = entitySql('usuarios');
const credentials = users.select('usuario', 'contrasena_hash');
const result = credentials.query(db, `WHERE ${users.column('id')} = $1`, ['id']);
type Selected = Awaited<typeof result>['rows'][number];
export type SelectionMatchesSsot = Assert<Equal<Selected, Pick<StoredRow<'usuarios'>, 'usuario' | 'contrasena_hash'>>>;
// @ts-expect-error Results contain only the columns selected by this query.
export type NotSelected = Selected['version_sesion'];
// @ts-expect-error Unknown entities cannot be used in static backend queries.
entitySql('missing-table');
// @ts-expect-error A removed or misspelled field must fail compilation.
users.select('password_hash');
// @ts-expect-error Fields from other entities cannot enter a selection.
users.select('plan');
// @ts-expect-error WHERE/SET identifiers use the same entity-specific field names.
users.column('plan');
// @ts-expect-error SELECT requires at least one column.
users.select();
declare const uncheckedName: string;
// @ts-expect-error An unchecked runtime string cannot become a SQL column.
users.column(uncheckedName);

const plans = entitySql('planes').select('plan', 'descripcion');
const planResult = plans.query(db);
type Plan = Awaited<typeof planResult>['rows'][number];
export type KeyIsRequired = Assert<Equal<Plan['plan'], number>>;
export type NullabilityIsPreserved = Assert<Equal<Plan['descripcion'], string | null>>;

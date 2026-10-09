import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {captureSystemSnapshot, definePersistence, toJsonValue, type ValidationResult} from 'system-definition';
import {
    generateCreate, projectSchema, quotePgIdentifier, sha256Hex,
    type StorageContext, type PgSchemaInfo, type ReleaseArtifactDraft, type ReleaseVerificationInput,
} from '@system-definition/postgres-migrations';
import {createMigrationProject} from './migration-project.js';
import {myRecords, myEntities} from './system.js';
import {appDatabaseUser, getMigrationDatabaseConfig} from './database.js';

export function valueOf<T>(result: ValidationResult<T>): T {
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    return result.value;
}
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const hashText = (text: string) => sha256Hex(new TextEncoder().encode(text));

export async function createInitialMigration(): Promise<{draft: ReleaseArtifactDraft; release: ReleaseVerificationInput}> {
    const snapshot = valueOf(captureSystemSnapshot(...createMigrationProject().capture));
    const persistence = definePersistence({...myRecords, entities: myEntities}, {
        entities: Object.keys(myEntities) as (keyof typeof myEntities)[],
        representations: {postgres: {text: 'text', integer: 'integer', boolean: 'boolean'}},
    });
    const config = getMigrationDatabaseConfig();
    const owner = config.connectionString ? decodeURIComponent(new URL(config.connectionString).username) : config.user;
    if (!owner || !appDatabaseUser || owner === appDatabaseUser) throw new Error('Migration owner and app user must be distinct.');
    const tables = persistence.entities.map(name => `"ssot".${quotePgIdentifier(name)}`).join(', ');
    const grants = `GRANT USAGE ON SCHEMA "ssot" TO ${quotePgIdentifier(appDatabaseUser)};\n`
        + `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${tables} TO ${quotePgIdentifier(appDatabaseUser)};\n`;
    const check = `SELECT
    current_user = ${literal(owner)}
    AND has_schema_privilege(${literal(appDatabaseUser)}, 'ssot', 'USAGE')
    AND NOT has_schema_privilege(${literal(appDatabaseUser)}, 'ssot', 'CREATE')
    AND NOT pg_has_role(${literal(appDatabaseUser)}, ${literal(owner)}, 'MEMBER')
    AND NOT EXISTS (SELECT FROM pg_roles WHERE rolname = ${literal(appDatabaseUser)} AND (rolsuper OR rolcreatedb OR rolcreaterole))
    AND (SELECT count(*) = ${persistence.entities.length}
        AND bool_and(pg_get_userbyid(c.relowner) = ${literal(owner)}
            AND has_table_privilege(${literal(appDatabaseUser)}, c.oid, 'SELECT')
            AND has_table_privilege(${literal(appDatabaseUser)}, c.oid, 'INSERT')
            AND has_table_privilege(${literal(appDatabaseUser)}, c.oid, 'UPDATE')
            AND has_table_privilege(${literal(appDatabaseUser)}, c.oid, 'DELETE'))
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'ssot' AND c.relkind = 'r'
            AND c.relname IN (${persistence.entities.map(literal).join(', ')})) AS ok;\n`;
    const grantRef = {name: 'app-grants', kind: 'sql' as const, contentHash: hashText(grants)};
    const checkRef = {name: 'ownership-permissions', kind: 'check' as const, contentHash: hashText(check)};
    const storage: StorageContext = {
        representation: 'postgres', schema: 'ssot',
        physicalTypes: {
            text: {schema: 'pg_catalog', name: 'text', modifiers: []},
            integer: {schema: 'pg_catalog', name: 'int4', modifiers: []},
            boolean: {schema: 'pg_catalog', name: 'bool', modifiers: []},
        },
        environment: {engine: 'postgresql', version: '18.6', serverVersionNum: 180006, encoding: 'UTF8', collations: {}, externalDependencies: {}},
        resources: {'app-grants': {ref: grantRef, text: grants}, 'ownership-permissions': {ref: checkRef, text: check}},
        createResources: [{id: 'app-grants', run: grantRef, dependsOn: [], expectedObjects: []}],
        managedData: [], invariantChecks: [checkRef],
    };
    const projected = valueOf(projectSchema(snapshot, persistence, storage));
    const schema: PgSchemaInfo = {formatVersion: projected.formatVersion, engineVersion: projected.engineVersion,
        schemas: projected.schemas, objects: projected.objects};
    const sql = valueOf(generateCreate(schema)).statements.map(statement => statement.text + ';\n').join('');
    const createRef = {name: 'create-tables', kind: 'sql' as const, contentHash: hashText(sql)};
    const packageDirectory = dirname(createRequire(import.meta.url).resolve('@system-definition/postgres-migrations/package.json'));
    const {version} = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8')) as {version: string};
    const provenance = async (name: string) => ({name, version,
        contentHash: sha256Hex(await readFile(join(packageDirectory, 'dist/src', name + '.js')))});
    const draft: ReleaseArtifactDraft = {
        systemId: snapshot.systemId, releaseId: 'initial', snapshot, persistence,
        schema: valueOf(toJsonValue(schema)),
        createPlan: {formatVersion: 1, schema: 'ssot', generatedSql: [createRef],
            extraResources: storage.createResources.map(resource => valueOf(toJsonValue(resource))), dataResources: [], after: [checkRef]},
        resources: {
            'create-tables': {kind: 'sql', path: 'resources/create-tables.sql', text: sql},
            'app-grants': {kind: 'sql', path: 'resources/app-grants.sql', text: grants},
            'ownership-permissions': {kind: 'check', path: 'resources/ownership-permissions.sql', text: check},
        },
        invariantChecks: ['ownership-permissions'], managedData: [], environment: storage.environment,
        generator: await provenance('generate-create'), inspector: await provenance('inspect-schema'),
    };
    // This reference identifies the unpublished input during scratch verification.
    // publishReleaseArtifact computes the final immutable release reference.
    const ref = {systemId: snapshot.systemId, releaseId: 'initial', releaseHash: hashText(JSON.stringify(draft))};
    return {draft, release: {ref, snapshot, persistence, storage, inspection: {schemas: ['ssot'], excluded: []}}};
}

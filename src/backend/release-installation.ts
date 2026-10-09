import {randomUUID} from 'node:crypto';
import type {ClientConfig} from 'pg';
import {canonicalJson, sameReleaseRef, toJsonValue, type ResourceRefInfo} from 'system-definition';
import {
    bootstrapJournal, compareSchemas, connectPostgres, createPostgresScratch,
    executePreparedSqlResource, inspectSchema, installBaseline, loadReleaseArtifact,
    prepareSqlResource, readHistory, readInstallation, runCheckResource, verifyHistory,
    withMigrationLock, type CreateResourceInfo, type PgSession, type ReleaseArtifact,
} from '@system-definition/postgres-migrations';
import {createInitialMigration, valueOf} from './initial-migration.js';

const journal = {schema: 'ssot_migrations'};

function resourceOf(artifact: ReleaseArtifact, ref: ResourceRefInfo) {
    const resource = artifact.resources[ref.name];
    if (!resource || resource.contentHash !== ref.contentHash || resource.kind !== ref.kind) {
        throw new Error(`migration.checksumMismatch: ${ref.name}`);
    }
    return {ref, text: resource.text};
}

async function executeRelease(session: PgSession, artifact: ReleaseArtifact): Promise<void> {
    for (const ref of artifact.createPlan.generatedSql) {
        valueOf(await executePreparedSqlResource(session, valueOf(prepareSqlResource(resourceOf(artifact, ref)))));
    }
    // ensureInitialInstallation compares this plan to the typed adapter before use.
    const extraResources = artifact.createPlan.extraResources as unknown as readonly CreateResourceInfo[];
    for (const extra of extraResources) {
        valueOf(await executePreparedSqlResource(session, valueOf(prepareSqlResource(resourceOf(artifact, extra.run)))));
    }
}

async function checkPermissions(session: PgSession, artifact: ReleaseArtifact): Promise<void> {
    for (const ref of artifact.manifest.invariantChecks) valueOf(await runCheckResource(session, resourceOf(artifact, ref)));
}

export async function ensureInitialInstallation(
    config: ClientConfig,
    directory = 'migrations/releases/initial',
    checkOnly = false,
) {
    // Loading verifies every published file's hash before opening the target database.
    const artifact = valueOf(await loadReleaseArtifact(directory));
    const current = await createInitialMigration();
    const json = (value: unknown) => canonicalJson(valueOf(toJsonValue(value)));
    for (const [published, expected] of [
        [artifact.snapshot, current.draft.snapshot], [artifact.persistence, current.draft.persistence],
        [artifact.schema, current.draft.schema], [artifact.createPlan, current.draft.createPlan],
    ]) {
        if (json(published) !== json(expected)) throw new Error('migration.releaseMismatch: publish a release matching the backend SSOT and configuration');
    }
    const scope = {systemId: artifact.snapshot.systemId, schemas: [artifact.createPlan.schema]};
    const inspection = {schemas: scope.schemas, excluded: []};
    const scratch = createPostgresScratch(config, scope.schemas);
    const reference = valueOf(await scratch.create('clean-target'));
    try {
        // Compare against PostgreSQL's own representation of the published SQL.
        await executeRelease(reference.session, artifact);
        await checkPermissions(reference.session, artifact);
        const expected = valueOf(await inspectSchema(reference.session, inspection));
        const result = await withMigrationLock({openTarget: () => connectPostgres(config)}, scope, 10_000, async session => {
            await session.query('BEGIN', []);
            let commitSent = false;
            try {
                valueOf(await bootstrapJournal(session, journal));
                const installation = valueOf(await readInstallation(session, journal, scope));
                if (installation) {
                    if (!sameReleaseRef(installation.baseline, artifact.manifest.release)
                        || !sameReleaseRef(installation.current, artifact.manifest.release)) {
                        throw new Error('migration.headMismatch: recorded database release differs from this application');
                    }
                    valueOf(verifyHistory(installation, valueOf(await readHistory(session, journal, installation.installationId))));
                } else {
                    if (checkOnly) throw new Error('migration.notInstalled: install the initial release first');
                    const observed = valueOf(await inspectSchema(session, inspection));
                    if (observed.schema.objects.length || observed.unknown.length) {
                        throw new Error('migration.baselineRequired: refusing to adopt an existing schema without migration history');
                    }
                    await executeRelease(session, artifact);
                }
                const observed = valueOf(await inspectSchema(session, inspection));
                const compared = valueOf(compareSchemas(expected.schema, observed));
                if (!compared.equal) throw new Error('migration.schemaDrift: ' + JSON.stringify(compared.differences));
                await checkPermissions(session, artifact);
                const confirmed = installation ?? valueOf(await installBaseline(session, journal, {
                    installationId: randomUUID(), scope, baseline: artifact.manifest.release,
                }));
                commitSent = true;
                await session.query('COMMIT', []);
                return {ok: true as const, value: {installation: confirmed, alreadyInstalled: installation !== null}};
            } catch (error) {
                if (commitSent) throw new Error('migration.unknownCommitOutcome: check the database before retrying');
                throw error;
            } finally {
                if (!commitSent) await session.query('ROLLBACK', []);
            }
        });
        return valueOf(result);
    } finally {
        valueOf(await scratch.destroy(reference));
    }
}

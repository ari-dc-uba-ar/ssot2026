import {createPostgresScratch, publishReleaseArtifact, verifyRelease} from '@system-definition/postgres-migrations';
import {getMigrationDatabaseConfig} from './database.js';
import {createInitialMigration, valueOf} from './initial-migration.js';

try {
    const {draft, release} = await createInitialMigration();
    // The library creates, checks, and removes an owned temporary database.
    // The application database is not used to rehearse the generated SQL.
    valueOf(await verifyRelease(release, createPostgresScratch(getMigrationDatabaseConfig(), ['ssot'])));
    const artifact = valueOf(await publishReleaseArtifact('migrations', draft));
    console.log(JSON.stringify({release: artifact.manifest.release, directory: 'migrations/releases/initial', verified: true}, null, 2));
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}

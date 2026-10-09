import {getMigrationDatabaseConfig} from './database.js';
import {ensureInitialInstallation} from './release-installation.js';

try {
    const result = await ensureInitialInstallation(getMigrationDatabaseConfig(), undefined, process.argv.includes('--check'));
    console.log(JSON.stringify({...result, verified: true}, null, 2));
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}

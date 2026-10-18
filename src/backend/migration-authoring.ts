import {fileURLToPath} from 'node:url';
import {invalidStore, openArtifactDirectory, sha256Hex, type SsotAuthoringRuntime} from '@system-definition/postgres-migrations';

export const migrationAuthoring = {
    async readSql(ref) {
        const directory = fileURLToPath(new URL('../../migrations/resources/', import.meta.url));
        const reader = await openArtifactDirectory(directory);
        if (!reader.ok) return reader;
        const loaded = await reader.value.read(ref.name);
        if (!loaded.ok) return loaded;
        if (sha256Hex(loaded.value) !== ref.contentHash) {
            return invalidStore('Authored SQL/check resource changed: ' + ref.name, 'migration.checksumMismatch');
        }
        return {ok: true, value: new TextDecoder('utf-8', {fatal: true}).decode(loaded.value)};
    },
} satisfies SsotAuthoringRuntime;

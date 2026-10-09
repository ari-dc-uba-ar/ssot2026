import type { captureSystemSnapshot } from 'system-definition';
import { myRecords, myEntities } from './system.js';

export function createMigrationProject() {
    const input = {
        systemId: 'ssot2026',
        entities: myEntities,
        records: myRecords.records,
    };
    return {
        // Preserve the concrete context; the generic project interface erases it.
        capture: [myRecords, input] satisfies Parameters<typeof captureSystemSnapshot<typeof myRecords, typeof input>>,
    };
}

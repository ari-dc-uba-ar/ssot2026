import type {EntityInfo} from 'system-definition';
import type {myContext} from './system.js';
import type {EntityForeignKey} from './browser-contract.js';
import {allowedFields} from './column-security.js';

// Editors use input names; read-only views use stored names, including non-writable FKs.
export function entityReferences(entity: EntityInfo<typeof myContext>, entities: ReadonlyMap<string, EntityInfo<typeof myContext>>,
    operation: 'read' | 'write'): EntityForeignKey[] {
    const sourceFields = allowedFields(entity, operation);
    return Object.entries(entity.fks).flatMap(([name, fk]) => {
        const target = entities.get(fk.entity)!;
        const targetFields = allowedFields(target, 'read');
        const pairs = Object.entries(fk.fields);
        if (!pairs.every(([source, destination]) => sourceFields[source] && targetFields[destination])) return [];
        return [{name, entity: target.name,
            fields: Object.fromEntries(pairs.map(([source, destination]) => [operation === 'write' ? sourceFields[source]!.inputName : source, destination])),
            displayFields: [...new Set([...pairs.map(([, destination]) => destination),
                ...Object.values(targetFields).filter(field => field.isName).map(field => field.name)])],
        }];
    });
}

import type {EntityInfo} from 'system-definition';
import type {myContext} from './system.js';

export function allowedFields(entity: EntityInfo<typeof myContext>, operation: 'read' | 'write'): EntityInfo<typeof myContext>['fields'] {
    return Object.fromEntries(Object.entries(entity.fields).filter(([, field]) => operation === 'read' ? field.readable : field.writable));
}

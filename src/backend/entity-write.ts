import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {instanceProblems, validateInstance, type EntityInfo} from 'system-definition';
import {quotePgIdentifier as quote} from '@system-definition/postgres-migrations';
import {myContext} from './system.js';
import {databaseSettings} from './database.js';
import {ApiFailure, readObject} from './api-errors.js';
import {allowedFields} from './column-security.js';
import {hashPassword, readPassword, readUsername} from './credentials.js';

export const entityTable = (name: string): string => `${quote(databaseSettings.database.schema)}.${quote(name)}`;

export async function prepareEntityWrite(entity: EntityInfo<typeof myContext>, body: unknown, operation: 'create' | 'update'): Promise<Record<string, unknown>> {
    const fields = Object.values(allowedFields(entity, 'write'));
    const optional = fields.filter(field => operation === 'update' && field.transform === 'password');
    const required = fields.filter(field => !optional.includes(field));
    const input = readObject(body, required.map(field => field.inputName), optional.map(field => field.inputName));
    const supplied = fields.filter(field => Object.hasOwn(input, field.inputName));
    const row = Object.fromEntries(supplied.map(field => [field.name, input[field.inputName]]));
    const problems = instanceProblems(myContext, Object.fromEntries(supplied.map(field => [field.name, {...field, type: field.inputType}])), row)
        .map(problem => ({...problem, field: problem.field === null ? null : entity.fields[problem.field]?.inputName ?? problem.field}));
    if (problems.length) throw new ApiFailure(400, problems.map(p => `${p.field ?? ''}: ${p.messageKey}`).join('; '), problems);
    const validation = validateInstance(myContext.validators, entity.validators, row);
    if (validation.length) throw new ApiFailure(400, validation.map(p => p.messageKey).join('; '), validation);
    for (const field of supplied) {
        if (field.transform === 'username') row[field.name] = readUsername(row[field.name]);
        if (field.transform === 'password') row[field.name] = await hashPassword(readPassword(row[field.name]));
    }
    const passwordChanged = supplied.some(field => field.transform === 'password');
    for (const field of Object.values(entity.fields)) {
        const generated = operation === 'create' ? field.onCreate : field.onUpdate;
        if (generated !== null) row[field.name] = generated === 'uuid' ? randomUUID() : '[]';
        if (passwordChanged && field.onPasswordChange === 'empty-array') row[field.name] = '[]';
    }
    return row;
}

export async function insertPreparedRow(db: Pick<Pool, 'query'>, entity: EntityInfo<typeof myContext>, row: Record<string, unknown>): Promise<void> {
    const names = Object.keys(row);
    await db.query(`INSERT INTO ${entityTable(entity.name)} (${names.map(quote).join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')})`, names.map(name => row[name]));
}

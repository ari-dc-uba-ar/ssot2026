import assert from 'node:assert/strict';

export function versionOf(entity, key) {
    const index = entity.rows.findIndex(row => Object.entries(key).every(([name, value]) => row[name] === value));
    assert.notEqual(index, -1, 'The version must come from a row actually read');
    return entity.versions[index];
}

export interface EntityDef {
    name: string;
    fields: Record<string, { name: string }>;
    pk: readonly string[];
}

export function selectQuery(entity: EntityDef) {
    const fields = Object.keys(entity.fields).join(', ');
    const pk = entity.pk.join(', ');
    return {
        text: `SELECT ${fields} FROM ssot.${entity.name} ORDER BY ${pk}`,
        values: [] as unknown[],
    };
}

export function insertQuery(entity: EntityDef, body: Record<string, unknown>) {
    const fields = Object.keys(entity.fields);
    const values = fields.map(field => body[field]);
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
    return {
        text: `INSERT INTO ssot.${entity.name} (${fields.join(', ')}) VALUES (${placeholders})`,
        values,
    };
}

export function updateQuery(entity: EntityDef, body: Record<string, unknown>) {
    const nonPkFields = Object.keys(entity.fields).filter(
        field => !entity.pk.includes(field) && body[field] !== undefined
    );
    const fields = nonPkFields.length > 0
        ? nonPkFields
        : Object.keys(entity.fields).filter(field => body[field] !== undefined);

    const values = fields.map(field => body[field]);
    const pkValues = entity.pk.map(pkField => body[pkField]);

    const setClause = fields.map((field, index) => `${field} = $${index + 1}`).join(', ');
    const whereClause = entity.pk
        .map((pkField, index) => `${pkField} = $${fields.length + index + 1}`)
        .join(' AND ');

    return {
        text: `UPDATE ssot.${entity.name} SET ${setClause} WHERE ${whereClause}`,
        values: [...values, ...pkValues],
    };
}

export function deleteQuery(entity: EntityDef, body: Record<string, unknown>) {
    const whereClause = entity.pk
        .map((pkField, index) => `${pkField} = $${index + 1}`)
        .join(' AND ');
    const values = entity.pk.map(pkField => body[pkField]);

    return {
        text: `DELETE FROM ssot.${entity.name} WHERE ${whereClause}`,
        values,
    };
}


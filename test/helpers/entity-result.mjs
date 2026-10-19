// Shape returned by the single-snapshot PostgreSQL read query.
export const entityResult = rows => ({rows: [{rows, versions: rows.map(() => '1'), total: rows.length, matched: rows.length, page: 1}]});

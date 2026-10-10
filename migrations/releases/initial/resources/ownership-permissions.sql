SELECT
    current_user = 'ssot2026_owner'
    AND has_schema_privilege('ssot2026_user', 'ssot', 'USAGE')
    AND NOT has_schema_privilege('ssot2026_user', 'ssot', 'CREATE')
    AND NOT pg_has_role('ssot2026_user', 'ssot2026_owner', 'MEMBER')
    AND NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ssot2026_user' AND (rolsuper OR rolcreatedb OR rolcreaterole))
    AND (SELECT count(*) = 3
        AND bool_and(pg_get_userbyid(c.relowner) = 'ssot2026_owner'
            AND has_table_privilege('ssot2026_user', c.oid, 'SELECT')
            AND has_table_privilege('ssot2026_user', c.oid, 'INSERT')
            AND has_table_privilege('ssot2026_user', c.oid, 'UPDATE')
            AND has_table_privilege('ssot2026_user', c.oid, 'DELETE'))
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'ssot' AND c.relkind = 'r'
            AND c.relname IN ('materias', 'pabellones', 'usuarios')) AS ok;

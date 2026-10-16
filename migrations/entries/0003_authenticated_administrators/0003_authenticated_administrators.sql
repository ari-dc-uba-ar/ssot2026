-- Migration: 0003_authenticated_administrators
-- Run with postgres-migrations; the runner enforces checks, validators and history.

-- Phase 2: owner (migration transaction)
BEGIN;

-- 001 001_remove_column_usuarios_administrador
ALTER TABLE "ssot"."usuarios" DROP COLUMN "administrador";

-- 002 002_remove_column_usuarios_activo
ALTER TABLE "ssot"."usuarios" DROP COLUMN "activo";

-- 003 app-permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ssot"."materias" TO "ssot2026_user";

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ssot"."pabellones" TO "ssot2026_user";

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ssot"."planes" TO "ssot2026_user";

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ssot"."usuarios" TO "ssot2026_user";

-- The runner verifies schema/data/permissions and records history before COMMIT.
COMMIT;

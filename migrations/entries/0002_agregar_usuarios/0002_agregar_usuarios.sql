-- Migration: 0002_agregar_usuarios
-- Run with postgres-migrations; the runner enforces checks, validators and history.

-- Phase 2: owner (migration transaction)
BEGIN;

-- 001 001_add_table_usuarios
CREATE TABLE "ssot"."usuarios" ();

-- 002 002_add_column_usuarios_usuario
ALTER TABLE "ssot"."usuarios" ADD COLUMN "usuario" "pg_catalog"."text" NOT NULL;

-- 003 003_add_column_usuarios_clave
ALTER TABLE "ssot"."usuarios" ADD COLUMN "clave" "pg_catalog"."text";

-- 004 004_add_constraint_usuarios_usuarios_pkey
ALTER TABLE "ssot"."usuarios" ADD CONSTRAINT "usuarios_pkey" PRIMARY KEY ("usuario");

-- 005 app-permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ssot"."materias" TO "ssot2026_user";

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ssot"."pabellones" TO "ssot2026_user";

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ssot"."planes" TO "ssot2026_user";

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ssot"."usuarios" TO "ssot2026_user";

-- The runner verifies schema/data/permissions and records history before COMMIT.
COMMIT;

-- Migration: 0002_authentication
-- Run with postgres-migrations; the runner enforces checks, validators and history.

-- Phase 2: owner (migration transaction)
BEGIN;

-- 001 001_add_table_usuarios
CREATE TABLE "ssot"."usuarios" ();

-- 002 002_add_column_usuarios_activo
ALTER TABLE "ssot"."usuarios" ADD COLUMN "activo" "pg_catalog"."bool" NOT NULL;

-- 003 003_add_column_usuarios_recuperacion_hashes
ALTER TABLE "ssot"."usuarios" ADD COLUMN "recuperacion_hashes" "pg_catalog"."text" NOT NULL;

-- 004 004_add_column_usuarios_administrador
ALTER TABLE "ssot"."usuarios" ADD COLUMN "administrador" "pg_catalog"."bool" NOT NULL;

-- 005 005_add_column_usuarios_contrasena_hash
ALTER TABLE "ssot"."usuarios" ADD COLUMN "contrasena_hash" "pg_catalog"."text" NOT NULL;

-- 006 006_add_column_usuarios_usuario
ALTER TABLE "ssot"."usuarios" ADD COLUMN "usuario" "pg_catalog"."text" NOT NULL;

-- 007 007_add_column_usuarios_version_sesion
ALTER TABLE "ssot"."usuarios" ADD COLUMN "version_sesion" "pg_catalog"."text" NOT NULL;

-- 008 008_add_column_usuarios_id
ALTER TABLE "ssot"."usuarios" ADD COLUMN "id" "pg_catalog"."text" NOT NULL;

-- 009 009_add_constraint_usuarios_usuarios_usuario_unico_key
ALTER TABLE "ssot"."usuarios" ADD CONSTRAINT "usuarios_usuario_unico_key" UNIQUE ("usuario");

-- 010 010_add_constraint_usuarios_usuarios_pkey
ALTER TABLE "ssot"."usuarios" ADD CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id");

-- 011 app-permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ssot"."materias" TO "ssot2026_user";

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ssot"."pabellones" TO "ssot2026_user";

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ssot"."planes" TO "ssot2026_user";

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ssot"."usuarios" TO "ssot2026_user";

-- The runner verifies schema/data/permissions and records history before COMMIT.
COMMIT;

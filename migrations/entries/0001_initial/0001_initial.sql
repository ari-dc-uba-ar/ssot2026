-- Migration: 0001_initial
-- Run with postgres-migrations; the runner enforces checks, validators and history.

-- Phase 1: initialUser (administrator)
-- Passwords are supplied by the runner from database settings.
BEGIN;

-- Create owner/app roles and their schemas
DO $roles$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ssot2026_owner') THEN
        CREATE ROLE "ssot2026_owner" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
        EXECUTE format('ALTER ROLE %I PASSWORD %L', 'ssot2026_owner', NULLIF(current_setting('migration.owner_password', true), ''));
    END IF;
END;
$roles$;

DO $roles$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ssot2026_user') THEN
        CREATE ROLE "ssot2026_user" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
        EXECUTE format('ALTER ROLE %I PASSWORD %L', 'ssot2026_user', NULLIF(current_setting('migration.app_password', true), ''));
    END IF;
END;
$roles$;

CREATE SCHEMA IF NOT EXISTS "ssot" AUTHORIZATION "ssot2026_owner";

CREATE SCHEMA IF NOT EXISTS "ssot_migrations" AUTHORIZATION "ssot2026_owner";

REVOKE CREATE ON SCHEMA "ssot" FROM PUBLIC, "ssot2026_user";

GRANT USAGE ON SCHEMA "ssot" TO "ssot2026_user";

ALTER DEFAULT PRIVILEGES FOR ROLE "ssot2026_owner" IN SCHEMA "ssot" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "ssot2026_user";

COMMIT;

-- Phase 2: owner (migration transaction)
BEGIN;

-- 001 001_add_table_planes
CREATE TABLE "ssot"."planes" ();

-- 002 002_add_table_materias
CREATE TABLE "ssot"."materias" ();

-- 003 003_add_table_pabellones
CREATE TABLE "ssot"."pabellones" ();

-- 004 004_add_column_planes_plan
ALTER TABLE "ssot"."planes" ADD COLUMN "plan" "pg_catalog"."int4" NOT NULL;

-- 005 005_add_column_materias_materia
ALTER TABLE "ssot"."materias" ADD COLUMN "materia" "pg_catalog"."text" NOT NULL;

-- 006 006_add_column_materias_obligatoria
ALTER TABLE "ssot"."materias" ADD COLUMN "obligatoria" "pg_catalog"."bool";

-- 007 007_add_column_pabellones_pab
ALTER TABLE "ssot"."pabellones" ADD COLUMN "pab" "pg_catalog"."text" NOT NULL;

-- 008 008_add_column_materias_plan
ALTER TABLE "ssot"."materias" ADD COLUMN "plan" "pg_catalog"."int4";

-- 009 009_add_column_pabellones_pisos
ALTER TABLE "ssot"."pabellones" ADD COLUMN "pisos" "pg_catalog"."int4";

-- 010 010_add_column_planes_descripcion
ALTER TABLE "ssot"."planes" ADD COLUMN "descripcion" "pg_catalog"."text";

-- 011 011_add_column_pabellones_pabellon
ALTER TABLE "ssot"."pabellones" ADD COLUMN "pabellon" "pg_catalog"."text";

-- 012 012_add_column_materias_cod_mat
ALTER TABLE "ssot"."materias" ADD COLUMN "cod_mat" "pg_catalog"."text";

-- 013 013_add_constraint_pabellones_pabellones_pkey
ALTER TABLE "ssot"."pabellones" ADD CONSTRAINT "pabellones_pkey" PRIMARY KEY ("pab");

-- 014 014_add_constraint_planes_planes_pkey
ALTER TABLE "ssot"."planes" ADD CONSTRAINT "planes_pkey" PRIMARY KEY ("plan");

-- 015 015_add_constraint_materias_materias_pkey
ALTER TABLE "ssot"."materias" ADD CONSTRAINT "materias_pkey" PRIMARY KEY ("materia");

-- 016 app-permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ssot"."materias" TO "ssot2026_user";

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ssot"."pabellones" TO "ssot2026_user";

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ssot"."planes" TO "ssot2026_user";

-- The runner verifies schema/data/permissions and records history before COMMIT.
COMMIT;

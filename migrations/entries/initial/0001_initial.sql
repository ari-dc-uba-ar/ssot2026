-- Migration: initial
-- Run with postgres-migrations; the runner enforces checks, validators and history.

-- Phase 1: initialUser (administrator)
-- Passwords are supplied by the runner from database settings.
BEGIN;

-- Historical role setup was external; this is the configured setup declaration.
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

-- 001 CREATE TABLE "ssot"."planes" ();
CREATE TABLE "ssot"."planes" ();

-- 002 CREATE TABLE "ssot"."materias" ();
CREATE TABLE "ssot"."materias" ();

-- 003 CREATE TABLE "ssot"."pabellones" ();
CREATE TABLE "ssot"."pabellones" ();

-- 004 ALTER TABLE "ssot"."pabellones" ADD COLUMN "pab" "pg_catalog"."text" NOT NULL;
ALTER TABLE "ssot"."pabellones" ADD COLUMN "pab" "pg_catalog"."text" NOT NULL;

-- 005 ALTER TABLE "ssot"."materias" ADD COLUMN "plan" "pg_catalog"."int4";
ALTER TABLE "ssot"."materias" ADD COLUMN "plan" "pg_catalog"."int4";

-- 006 ALTER TABLE "ssot"."materias" ADD COLUMN "obligatoria" "pg_catalog"."bool";
ALTER TABLE "ssot"."materias" ADD COLUMN "obligatoria" "pg_catalog"."bool";

-- 007 ALTER TABLE "ssot"."materias" ADD COLUMN "materia" "pg_catalog"."text" NOT NULL;
ALTER TABLE "ssot"."materias" ADD COLUMN "materia" "pg_catalog"."text" NOT NULL;

-- 008 ALTER TABLE "ssot"."pabellones" ADD COLUMN "pabellon" "pg_catalog"."text";
ALTER TABLE "ssot"."pabellones" ADD COLUMN "pabellon" "pg_catalog"."text";

-- 009 ALTER TABLE "ssot"."planes" ADD COLUMN "plan" "pg_catalog"."int4" NOT NULL;
ALTER TABLE "ssot"."planes" ADD COLUMN "plan" "pg_catalog"."int4" NOT NULL;

-- 010 ALTER TABLE "ssot"."pabellones" ADD COLUMN "pisos" "pg_catalog"."int4";
ALTER TABLE "ssot"."pabellones" ADD COLUMN "pisos" "pg_catalog"."int4";

-- 011 ALTER TABLE "ssot"."planes" ADD COLUMN "descripcion" "pg_catalog"."text";
ALTER TABLE "ssot"."planes" ADD COLUMN "descripcion" "pg_catalog"."text";

-- 012 ALTER TABLE "ssot"."materias" ADD COLUMN "cod_mat" "pg_catalog"."text";
ALTER TABLE "ssot"."materias" ADD COLUMN "cod_mat" "pg_catalog"."text";

-- 013 ALTER TABLE "ssot"."planes" ADD CONSTRAINT "planes_pkey" PRIMARY KEY ("plan");
ALTER TABLE "ssot"."planes" ADD CONSTRAINT "planes_pkey" PRIMARY KEY ("plan");

-- 014 ALTER TABLE "ssot"."pabellones" ADD CONSTRAINT "pabellones_pkey" PRIMARY KEY ("pab");
ALTER TABLE "ssot"."pabellones" ADD CONSTRAINT "pabellones_pkey" PRIMARY KEY ("pab");

-- 015 ALTER TABLE "ssot"."materias" ADD CONSTRAINT "materias_pkey" PRIMARY KEY ("materia");
ALTER TABLE "ssot"."materias" ADD CONSTRAINT "materias_pkey" PRIMARY KEY ("materia");

-- The runner verifies schema/data/permissions and records history before COMMIT.
COMMIT;

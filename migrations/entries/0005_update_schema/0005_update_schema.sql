BEGIN;

SELECT NOT EXISTS (SELECT 1 FROM "ssot"."materias") AS ok;

SELECT NOT EXISTS (SELECT 1 FROM "ssot"."materias") AS ok;

SELECT NOT EXISTS (SELECT 1 FROM "ssot"."materias") AS ok;

SELECT NOT EXISTS (SELECT 1 FROM "ssot"."materias") AS ok;

ALTER TABLE "ssot"."materias" DROP CONSTRAINT "materias_pkey";

CREATE TABLE "ssot"."enrolamientos" ();

CREATE TABLE "ssot"."estudiantes" ();

CREATE TABLE "ssot"."departamentos" ();

ALTER TABLE "ssot"."enrolamientos" ADD COLUMN "regularidad" "pg_catalog"."text";

ALTER TABLE "ssot"."enrolamientos" ADD COLUMN "legajo" "pg_catalog"."text" NOT NULL;

ALTER TABLE "ssot"."estudiantes" ADD COLUMN "legajo" "pg_catalog"."text" NOT NULL;

ALTER TABLE "ssot"."enrolamientos" ADD COLUMN "cod_dep" "pg_catalog"."text" NOT NULL;

ALTER TABLE "ssot"."enrolamientos" ADD COLUMN "cuatrimestre" "pg_catalog"."text" NOT NULL;

ALTER TABLE "ssot"."materias" ADD COLUMN "cod_dep" "pg_catalog"."text" NOT NULL;

ALTER TABLE "ssot"."departamentos" ADD COLUMN "departamento" "pg_catalog"."text";

ALTER TABLE "ssot"."enrolamientos" ADD COLUMN "cod_mat" "pg_catalog"."text" NOT NULL;

ALTER TABLE "ssot"."estudiantes" ADD COLUMN "nombre" "pg_catalog"."text";

ALTER TABLE "ssot"."enrolamientos" ADD COLUMN "año" "pg_catalog"."int4" NOT NULL;

ALTER TABLE "ssot"."departamentos" ADD COLUMN "pabellon" "pg_catalog"."text";

ALTER TABLE "ssot"."enrolamientos" ADD COLUMN "nota" "pg_catalog"."int4";

ALTER TABLE "ssot"."departamentos" ADD COLUMN "cod_dep" "pg_catalog"."text" NOT NULL;

ALTER TABLE "ssot"."materias" ALTER COLUMN "materia" DROP NOT NULL;

ALTER TABLE "ssot"."materias" ALTER COLUMN "cod_mat" SET NOT NULL;

ALTER TABLE "ssot"."enrolamientos" ADD CONSTRAINT "enrolamientos_pkey" PRIMARY KEY ("legajo", "cod_mat", "cod_dep", "año", "cuatrimestre");

ALTER TABLE "ssot"."materias" ADD CONSTRAINT "materias_pkey" PRIMARY KEY ("cod_mat", "cod_dep");

ALTER TABLE "ssot"."departamentos" ADD CONSTRAINT "departamentos_pkey" PRIMARY KEY ("cod_dep");

ALTER TABLE "ssot"."estudiantes" ADD CONSTRAINT "estudiantes_pkey" PRIMARY KEY ("legajo");

ALTER TABLE "ssot"."materias" ADD CONSTRAINT "materias_departamento_fkey" FOREIGN KEY ("cod_dep") REFERENCES "ssot"."departamentos" ("cod_dep");

ALTER TABLE "ssot"."departamentos" ADD CONSTRAINT "departamentos_pabellon_fkey" FOREIGN KEY ("pabellon") REFERENCES "ssot"."pabellones" ("pab");

ALTER TABLE "ssot"."enrolamientos" ADD CONSTRAINT "enrolamientos_estudiante_fkey" FOREIGN KEY ("legajo") REFERENCES "ssot"."estudiantes" ("legajo");

ALTER TABLE "ssot"."enrolamientos" ADD CONSTRAINT "enrolamientos_materia_fkey" FOREIGN KEY ("cod_dep", "cod_mat") REFERENCES "ssot"."materias" ("cod_dep", "cod_mat");

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ssot"."departamentos" TO "ssot2026_user";

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ssot"."enrolamientos" TO "ssot2026_user";

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ssot"."estudiantes" TO "ssot2026_user";

COMMIT;

CREATE TABLE "ssot"."materias" ("cod_mat" "pg_catalog"."text", "materia" "pg_catalog"."text" NOT NULL, "obligatoria" "pg_catalog"."bool");
CREATE TABLE "ssot"."pabellones" ("pab" "pg_catalog"."text" NOT NULL, "pabellon" "pg_catalog"."text", "pisos" "pg_catalog"."int4");
ALTER TABLE "ssot"."materias" ADD CONSTRAINT "materias_pkey" PRIMARY KEY ("materia");
ALTER TABLE "ssot"."pabellones" ADD CONSTRAINT "pabellones_pkey" PRIMARY KEY ("pab");

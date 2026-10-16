BEGIN;

CREATE TABLE "ssot"."usuarios" ();

ALTER TABLE "ssot"."usuarios" ADD COLUMN "activo" "pg_catalog"."bool" NOT NULL;

ALTER TABLE "ssot"."usuarios" ADD COLUMN "recuperacion_hashes" "pg_catalog"."text" NOT NULL;

ALTER TABLE "ssot"."usuarios" ADD COLUMN "administrador" "pg_catalog"."bool" NOT NULL;

ALTER TABLE "ssot"."usuarios" ADD COLUMN "contrasena_hash" "pg_catalog"."text" NOT NULL;

ALTER TABLE "ssot"."usuarios" ADD COLUMN "usuario" "pg_catalog"."text" NOT NULL;

ALTER TABLE "ssot"."usuarios" ADD COLUMN "version_sesion" "pg_catalog"."text" NOT NULL;

ALTER TABLE "ssot"."usuarios" ADD COLUMN "id" "pg_catalog"."text" NOT NULL;

ALTER TABLE "ssot"."usuarios" ADD CONSTRAINT "usuarios_usuario_unico_key" UNIQUE ("usuario");

ALTER TABLE "ssot"."usuarios" ADD CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id");

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ssot"."usuarios" TO "ssot2026_user";

COMMIT;

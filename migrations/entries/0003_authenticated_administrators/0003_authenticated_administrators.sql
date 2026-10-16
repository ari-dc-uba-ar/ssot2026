BEGIN;

ALTER TABLE "ssot"."usuarios" DROP COLUMN "administrador";

ALTER TABLE "ssot"."usuarios" DROP COLUMN "activo";

COMMIT;

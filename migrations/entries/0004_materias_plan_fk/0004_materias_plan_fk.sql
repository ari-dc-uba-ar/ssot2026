BEGIN;

ALTER TABLE "ssot"."materias" ADD CONSTRAINT "materias_plan_fkey" FOREIGN KEY ("plan") REFERENCES "ssot"."planes" ("plan");

COMMIT;

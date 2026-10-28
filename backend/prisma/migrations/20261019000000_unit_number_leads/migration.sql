-- CreateEnum
CREATE TYPE "lead_stage" AS ENUM ('new', 'contacted', 'trial', 'contract', 'enrolled', 'lost');

-- AlterTable
ALTER TABLE "study_units" ADD COLUMN     "number" INTEGER;

-- Migration jadval egasi nomidan ishlaydi va FORCE RLS unga ham amal qiladi — backfill uchun vaqtincha o'chiriladi
ALTER TABLE study_units NO FORCE ROW LEVEL SECURITY;
ALTER TABLE number_sequences NO FORCE ROW LEVEL SECURITY;
UPDATE study_units u SET number = r.rn
FROM (SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS rn FROM study_units) r
WHERE r.id = u.id;
INSERT INTO number_sequences (tenant_id, kind, year, last_value)
SELECT tenant_id, 'study_unit', 0, max(number) FROM study_units GROUP BY tenant_id;
ALTER TABLE study_units FORCE ROW LEVEL SECURITY;
ALTER TABLE number_sequences FORCE ROW LEVEL SECURITY;
ALTER TABLE "study_units" ALTER COLUMN "number" SET NOT NULL;

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "discipline_id" UUID,
    "level_id" UUID,
    "ad_source_id" UUID,
    "owner_id" UUID,
    "stage" "lead_stage" NOT NULL DEFAULT 'new',
    "note" TEXT,
    "lost_reason" TEXT,
    "student_id" UUID,
    "last_activity_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "from_stage" "lead_stage",
    "to_stage" "lead_stage",
    "text" TEXT,
    "actor_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leads_tenant_id_stage_created_at_idx" ON "leads"("tenant_id", "stage", "created_at" DESC);

-- CreateIndex
CREATE INDEX "leads_tenant_id_owner_id_stage_idx" ON "leads"("tenant_id", "owner_id", "stage");

-- CreateIndex
CREATE INDEX "lead_events_lead_id_created_at_idx" ON "lead_events"("lead_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "study_units_tenant_id_number_key" ON "study_units"("tenant_id", "number");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_discipline_id_fkey" FOREIGN KEY ("discipline_id") REFERENCES "dictionary_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "dictionary_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_ad_source_id_fkey" FOREIGN KEY ("ad_source_id") REFERENCES "dictionary_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- RLS (TZ 8.4)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['leads','lead_events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = nullif(current_setting(''app.current_tenant'', true), '''')::uuid)
         WITH CHECK (tenant_id = nullif(current_setting(''app.current_tenant'', true), '''')::uuid)', t);
  END LOOP;
END $$;

-- CreateEnum
CREATE TYPE "dictionary_kind" AS ENUM ('discipline', 'level', 'age_category', 'study_unit_type', 'ad_source', 'learning_goal', 'cancel_reason');

-- CreateEnum
CREATE TYPE "gender" AS ENUM ('male', 'female');

-- CreateEnum
CREATE TYPE "student_status" AS ENUM ('new', 'active', 'paused', 'finished', 'archived');

-- CreateTable
CREATE TABLE "dictionary_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "kind" "dictionary_kind" NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dictionary_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "skip_lessons" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "birth_date" DATE,
    "gender" "gender",
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_persons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "is_bill_recipient" BOOLEAN NOT NULL DEFAULT false,
    "receives_notifications" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "status" "student_status" NOT NULL DEFAULT 'new',
    "owner_id" UUID,
    "cached_balance" BIGINT NOT NULL DEFAULT 0,
    "blacklisted" BOOLEAN NOT NULL DEFAULT false,
    "blacklist_reason" TEXT,
    "ad_source_id" UUID,
    "learning_goal_id" UUID,
    "notification_language" VARCHAR(5) NOT NULL DEFAULT 'uz',
    "note" TEXT,
    "custom_data" JSONB NOT NULL DEFAULT '{}',
    "archived_at" TIMESTAMPTZ,
    "merged_into_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dictionary_items_tenant_id_kind_name_key" ON "dictionary_items"("tenant_id", "kind", "name");

-- CreateIndex
CREATE INDEX "holidays_tenant_id_date_idx" ON "holidays"("tenant_id", "date");

-- CreateIndex
CREATE INDEX "clients_tenant_id_phone_idx" ON "clients"("tenant_id", "phone");

-- CreateIndex
CREATE INDEX "contact_persons_client_id_idx" ON "contact_persons"("client_id");

-- CreateIndex
CREATE INDEX "contact_persons_tenant_id_phone_idx" ON "contact_persons"("tenant_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "students_client_id_key" ON "students"("client_id");

-- CreateIndex
CREATE INDEX "students_tenant_id_branch_id_status_idx" ON "students"("tenant_id", "branch_id", "status");

-- CreateIndex
CREATE INDEX "students_tenant_id_created_at_id_idx" ON "students"("tenant_id", "created_at" DESC, "id");

-- CreateIndex
CREATE INDEX "students_tenant_id_owner_id_idx" ON "students"("tenant_id", "owner_id");

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_persons" ADD CONSTRAINT "contact_persons_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_ad_source_id_fkey" FOREIGN KEY ("ad_source_id") REFERENCES "dictionary_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_learning_goal_id_fkey" FOREIGN KEY ("learning_goal_id") REFERENCES "dictionary_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- RLS (TZ 8.4)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['dictionary_items','holidays','clients','contact_persons','students']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = nullif(current_setting(''app.current_tenant'', true), '''')::uuid)
         WITH CHECK (tenant_id = nullif(current_setting(''app.current_tenant'', true), '''')::uuid)', t);
  END LOOP;
END $$;

-- Ism bo'yicha "contains" qidiruv 50k+ o'quvchida ham tez ishlashi uchun
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX clients_full_name_trgm ON clients USING gin (full_name gin_trgm_ops);

-- Qarzdorlar ro'yxati (TZ 8.3)
CREATE INDEX students_debtors ON students (tenant_id, cached_balance) WHERE cached_balance < 0;

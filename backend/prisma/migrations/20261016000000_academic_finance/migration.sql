-- CreateEnum
CREATE TYPE "study_unit_status" AS ENUM ('forming', 'active', 'paused', 'finished');

-- CreateEnum
CREATE TYPE "lesson_status" AS ENUM ('planned', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "attendance_status" AS ENUM ('present', 'late', 'absent_unexcused', 'absent_excused');

-- CreateTable
CREATE TABLE "study_units" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "discipline_id" UUID NOT NULL,
    "level_id" UUID,
    "teacher_id" UUID NOT NULL,
    "classroom_id" UUID,
    "capacity" INTEGER NOT NULL,
    "price_amount" BIGINT NOT NULL,
    "status" "study_unit_status" NOT NULL DEFAULT 'forming',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "study_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "study_unit_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "price_amount" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "study_unit_id" UUID NOT NULL,
    "days_of_week" INTEGER[],
    "start_time" VARCHAR(5) NOT NULL,
    "end_time" VARCHAR(5) NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,

    CONSTRAINT "schedule_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lessons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "study_unit_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "start_at" TIMESTAMPTZ NOT NULL,
    "end_at" TIMESTAMPTZ NOT NULL,
    "classroom_id" UUID,
    "teacher_id" UUID NOT NULL,
    "status" "lesson_status" NOT NULL DEFAULT 'planned',
    "generated" BOOLEAN NOT NULL DEFAULT true,
    "cancel_reason" TEXT,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "status" "attendance_status" NOT NULL,
    "marked_by" UUID,
    "marked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "enrollment_id" UUID,
    "entry_type" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_type" TEXT NOT NULL,
    "source_id" UUID,
    "reverses_entry_id" UUID,
    "charge_revision" INTEGER NOT NULL DEFAULT 0,
    "method" TEXT,
    "comment" TEXT,
    "created_by" UUID,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "study_units_tenant_id_branch_id_status_idx" ON "study_units"("tenant_id", "branch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "study_units_tenant_id_name_key" ON "study_units"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "enrollments_study_unit_id_idx" ON "enrollments"("study_unit_id");

-- CreateIndex
CREATE INDEX "enrollments_student_id_idx" ON "enrollments"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_rules_study_unit_id_key" ON "schedule_rules"("study_unit_id");

-- CreateIndex
CREATE INDEX "lessons_tenant_id_study_unit_id_start_at_idx" ON "lessons"("tenant_id", "study_unit_id", "start_at");

-- CreateIndex
CREATE INDEX "lessons_tenant_id_teacher_id_start_at_idx" ON "lessons"("tenant_id", "teacher_id", "start_at");

-- CreateIndex
CREATE INDEX "lessons_tenant_id_classroom_id_start_at_idx" ON "lessons"("tenant_id", "classroom_id", "start_at");

-- CreateIndex
CREATE INDEX "attendances_student_id_marked_at_idx" ON "attendances"("student_id", "marked_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "attendances_lesson_id_student_id_key" ON "attendances"("lesson_id", "student_id");

-- CreateIndex
CREATE INDEX "ledger_entries_tenant_id_student_id_occurred_at_idx" ON "ledger_entries"("tenant_id", "student_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "ledger_entries_tenant_id_occurred_at_idx" ON "ledger_entries"("tenant_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "study_units" ADD CONSTRAINT "study_units_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_units" ADD CONSTRAINT "study_units_discipline_id_fkey" FOREIGN KEY ("discipline_id") REFERENCES "dictionary_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_units" ADD CONSTRAINT "study_units_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "dictionary_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_units" ADD CONSTRAINT "study_units_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_units" ADD CONSTRAINT "study_units_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_study_unit_id_fkey" FOREIGN KEY ("study_unit_id") REFERENCES "study_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_rules" ADD CONSTRAINT "schedule_rules_study_unit_id_fkey" FOREIGN KEY ("study_unit_id") REFERENCES "study_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_study_unit_id_fkey" FOREIGN KEY ("study_unit_id") REFERENCES "study_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- RLS (TZ 8.4)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['study_units','enrollments','schedule_rules','lessons','attendances','ledger_entries']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = nullif(current_setting(''app.current_tenant'', true), '''')::uuid)
         WITH CHECK (tenant_id = nullif(current_setting(''app.current_tenant'', true), '''')::uuid)', t);
  END LOOP;
END $$;

-- BR-E1: bir (o'quvchi, guruh) uchun a'zolik oraliqlari kesishmaydi; end_date inclusive, NULL = cheksiz
ALTER TABLE enrollments ADD CONSTRAINT enrollments_no_overlap
  EXCLUDE USING gist (student_id WITH =, study_unit_id WITH =, daterange(start_date, end_date, '[]') WITH &&);

-- Konflikt nazorati (M4.4): bir vaqtda bir xonada / bir o'qituvchida ikki dars bo'lmaydi.
-- tstzrange default '[)' — ketma-ket darslar (10:00–11:30, 11:30–13:00) to'qnashmaydi; bekor qilingan dars slotni bo'shatadi.
ALTER TABLE lessons ADD CONSTRAINT lessons_classroom_no_overlap
  EXCLUDE USING gist (classroom_id WITH =, tstzrange(start_at, end_at) WITH &&)
  WHERE (status <> 'cancelled' AND classroom_id IS NOT NULL);
ALTER TABLE lessons ADD CONSTRAINT lessons_teacher_no_overlap
  EXCLUDE USING gist (teacher_id WITH =, tstzrange(start_at, end_at) WITH &&)
  WHERE (status <> 'cancelled');
ALTER TABLE lessons ADD CONSTRAINT lessons_time_order CHECK (end_at > start_at);

-- Ledger append-only (M6.4): UPDATE/DELETE xato bilan to'xtaydi (jimgina yutilmaydi)
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
REVOKE UPDATE, DELETE ON ledger_entries FROM educrm_app;

-- Bitta yozuv faqat bir marta storno qilinadi
CREATE UNIQUE INDEX ledger_single_reversal ON ledger_entries (reverses_entry_id) WHERE reverses_entry_id IS NOT NULL;
-- Yechim idempotency (M6.6): dars ikki marta yakunlansa ham bitta yechim
CREATE UNIQUE INDEX ledger_charge_idem ON ledger_entries (source_type, source_id, student_id, entry_type, charge_revision)
  WHERE entry_type = 'charge' AND reverses_entry_id IS NULL;

-- AlterTable
ALTER TABLE "files" ADD COLUMN     "name" TEXT;

-- CreateTable
CREATE TABLE "materials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "study_unit_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "file_id" UUID,
    "link" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "study_unit_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "file_id" UUID,
    "due_date" DATE,
    "max_score" INTEGER NOT NULL DEFAULT 100,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "text" TEXT,
    "file_id" UUID,
    "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score" INTEGER,
    "feedback" TEXT,
    "graded_by" UUID,
    "graded_at" TIMESTAMPTZ,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "materials_study_unit_id_created_at_idx" ON "materials"("study_unit_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "assignments_study_unit_id_created_at_idx" ON "assignments"("study_unit_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "submissions_student_id_idx" ON "submissions"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_assignment_id_student_id_key" ON "submissions"("assignment_id", "student_id");

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_study_unit_id_fkey" FOREIGN KEY ("study_unit_id") REFERENCES "study_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_study_unit_id_fkey" FOREIGN KEY ("study_unit_id") REFERENCES "study_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- RLS (TZ 8.4)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['materials','assignments','submissions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = nullif(current_setting(''app.current_tenant'', true), '''')::uuid)
         WITH CHECK (tenant_id = nullif(current_setting(''app.current_tenant'', true), '''')::uuid)', t);
  END LOOP;
END $$;

-- Ruxsatlar katalogi (umumiy jadval, tenant'siz)
INSERT INTO permissions (code, "group", description) VALUES
  ('material.manage', 'Ta''lim', 'material.manage'),
  ('homework.manage', 'Ta''lim', 'homework.manage')
ON CONFLICT (code) DO NOTHING;

-- Yangi ruxsatlar mavjud tizim rollariga: egasi va filial boshqaruvchisi — hammasi, o'qituvchi — o'z guruhlari
ALTER TABLE roles NO FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions NO FORCE ROW LEVEL SECURITY;
INSERT INTO role_permissions (tenant_id, role_id, permission_code, scope)
SELECT r.tenant_id, r.id, p.code, CASE r.code WHEN 'owner' THEN 'all' WHEN 'teacher' THEN 'own' ELSE 'branch' END::"permission_scope"
FROM roles r CROSS JOIN (VALUES ('material.manage'), ('homework.manage')) AS p(code)
WHERE r.is_system AND r.code IN ('owner', 'branch_manager', 'teacher')
ON CONFLICT DO NOTHING;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;

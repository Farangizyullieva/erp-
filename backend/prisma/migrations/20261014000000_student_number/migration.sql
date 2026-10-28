-- Tenant bo'yicha ketma-ket raqamlar
CREATE TABLE "number_sequences" (
    "tenant_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "year" INTEGER NOT NULL DEFAULT 0,
    "last_value" INTEGER NOT NULL,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("tenant_id","kind","year")
);

ALTER TABLE number_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE number_sequences FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON number_sequences
  USING (tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid);

-- O'quvchi raqami: mavjud yozuvlar yaratilgan tartibida raqamlanadi, keyin ustun majburiy bo'ladi
ALTER TABLE "students" ADD COLUMN "number" INTEGER;

-- Migration jadval egasi nomidan ishlaydi va FORCE RLS unga ham amal qiladi — backfill uchun vaqtincha o'chiriladi
ALTER TABLE students NO FORCE ROW LEVEL SECURITY;
ALTER TABLE number_sequences NO FORCE ROW LEVEL SECURITY;

UPDATE students s SET number = r.rn
FROM (SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS rn FROM students) r
WHERE r.id = s.id;

INSERT INTO number_sequences (tenant_id, kind, year, last_value)
SELECT tenant_id, 'student', 0, max(number) FROM students GROUP BY tenant_id;

ALTER TABLE students FORCE ROW LEVEL SECURITY;
ALTER TABLE number_sequences FORCE ROW LEVEL SECURITY;

ALTER TABLE "students" ALTER COLUMN "number" SET NOT NULL;
CREATE UNIQUE INDEX "students_tenant_id_number_key" ON "students"("tenant_id", "number");

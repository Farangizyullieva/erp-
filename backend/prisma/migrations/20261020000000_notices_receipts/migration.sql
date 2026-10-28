-- AlterTable
ALTER TABLE "ledger_entries" ADD COLUMN     "receipt_number" INTEGER;

-- AlterTable
ALTER TABLE "message_log" ADD COLUMN     "ref_id" UUID;

-- AlterTable
ALTER TABLE "tenant_settings" ADD COLUMN     "absence_notice_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "payment_reminder_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "payment_reminder_last_date" TEXT,
ADD COLUMN     "receipt_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "message_log_tenant_id_kind_ref_id_idx" ON "message_log"("tenant_id", "kind", "ref_id");


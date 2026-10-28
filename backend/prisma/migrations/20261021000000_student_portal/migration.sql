-- AlterTable
ALTER TABLE "students" ADD COLUMN     "portal_user_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "students_portal_user_id_key" ON "students"("portal_user_id");

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_portal_user_id_fkey" FOREIGN KEY ("portal_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


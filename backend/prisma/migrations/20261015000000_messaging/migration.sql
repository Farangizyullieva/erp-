-- CreateTable
CREATE TABLE "messenger_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "contact_person_id" UUID NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'telegram',
    "external_chat_id" TEXT NOT NULL,
    "linked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blocked_at" TIMESTAMPTZ,

    CONSTRAINT "messenger_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messenger_link_tokens" (
    "token_hash" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contact_person_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,

    CONSTRAINT "messenger_link_tokens_pkey" PRIMARY KEY ("token_hash")
);

-- CreateTable
CREATE TABLE "message_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "contact_person_id" UUID,
    "student_id" UUID,
    "channel" TEXT NOT NULL DEFAULT 'telegram',
    "kind" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ,

    CONSTRAINT "message_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_settings" (
    "tenant_id" UUID NOT NULL,
    "weekly_report_enabled" BOOLEAN NOT NULL DEFAULT false,
    "weekly_report_last_week" TEXT,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "messenger_links_contact_person_id_channel_external_chat_id_key" ON "messenger_links"("contact_person_id", "channel", "external_chat_id");

-- CreateIndex
CREATE INDEX "message_log_tenant_id_created_at_idx" ON "message_log"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "message_log_status_next_attempt_at_idx" ON "message_log"("status", "next_attempt_at");

-- AddForeignKey
ALTER TABLE "messenger_links" ADD CONSTRAINT "messenger_links_contact_person_id_fkey" FOREIGN KEY ("contact_person_id") REFERENCES "contact_persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messenger_link_tokens" ADD CONSTRAINT "messenger_link_tokens_contact_person_id_fkey" FOREIGN KEY ("contact_person_id") REFERENCES "contact_persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- RLS (TZ 8.4)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['messenger_links','messenger_link_tokens','message_log','tenant_settings']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = nullif(current_setting(''app.current_tenant'', true), '''')::uuid)
         WITH CHECK (tenant_id = nullif(current_setting(''app.current_tenant'', true), '''')::uuid)', t);
  END LOOP;
END $$;

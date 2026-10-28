-- Platforma darajasidagi sozlamalar: tenant_id yo'q, shuning uchun RLS qo'llanmaydi
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

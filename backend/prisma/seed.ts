// Boshlang'ich ma'lumot: tenant, ruxsatlar katalogi, tizim rollari, owner va birinchi filial.
// Jadval egasi (DATABASE_MIGRATE_URL) nomidan ishlaydi; qayta ishga tushirish xavfsiz (idempotent).
import 'dotenv/config';
import { hash } from '@node-rs/argon2';
import { PrismaClient } from '@prisma/client';
import { ALL_PERMISSIONS, SYSTEM_ROLES } from '../src/common/auth/permissions.catalog';
import { normalizePhone } from '../src/common/utils/phone';

const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_MIGRATE_URL });

async function main(): Promise<void> {
  const slug = process.env.DEFAULT_TENANT_SLUG ?? 'najot-talim';
  const phone = normalizePhone(process.env.SEED_OWNER_PHONE ?? '');
  const password = process.env.SEED_OWNER_PASSWORD ?? '';
  if (!phone) throw new Error('SEED_OWNER_PHONE noto\'g\'ri');
  if (password.length < 10) throw new Error('SEED_OWNER_PASSWORD kamida 10 belgi bo\'lishi kerak');

  for (const p of ALL_PERMISSIONS) {
    await db.permission.upsert({
      where: { code: p.code },
      update: { group: p.group },
      create: { code: p.code, group: p.group, description: p.code },
    });
  }

  const tenant = await db.tenant.upsert({ where: { slug }, update: {}, create: { slug, name: "Najot Ta'lim" } });

  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenant.id}, true)`;

    for (const seed of SYSTEM_ROLES) {
      const existing = await tx.role.findFirst({ where: { code: seed.code } });
      if (existing) continue; // sozlangan rollar ustidan yozilmaydi
      await tx.role.create({
        data: {
          tenantId: tenant.id,
          code: seed.code,
          name: seed.name,
          isSystem: true,
          permissions: {
            create: [...new Set(seed.permissions)].map((permissionCode) => ({
              tenantId: tenant.id,
              permissionCode,
              scope: seed.scope,
            })),
          },
        },
      });
    }

    // owner roli har doim to'liq katalogga ega (yangi ruxsat qo'shilganda ham)
    const owner = await tx.role.findFirstOrThrow({ where: { code: 'owner' } });
    await tx.rolePermission.createMany({
      data: ALL_PERMISSIONS.map((p) => ({ tenantId: tenant.id, roleId: owner.id, permissionCode: p.code, scope: 'all' as const })),
      skipDuplicates: true,
    });

    // Boshlang'ich ma'lumotnomalar (TZ M1.3 misollari) — tur bo'sh bo'lsagina
    const defaults = {
      discipline: ['Backend', 'Frontend', 'Ingliz tili'],
      level: ['Beginner', 'A1', 'A2', 'B1', 'B2', 'Junior', 'Middle'],
      age_category: ['Bolalar 7–10', "O'smirlar", 'Kattalar'],
      study_unit_type: ['Standart', 'Intensiv', 'Online'],
      ad_source: ['Instagram', 'Telegram', 'Tavsiya', 'Google'],
      learning_goal: ['Kasb egallash', 'Imtihonga tayyorgarlik', "O'zi uchun"],
      cancel_reason: ["O'qituvchi kasal", 'Bayram', 'Texnik sabab'],
    } as const;
    for (const [kind, names] of Object.entries(defaults) as [keyof typeof defaults, readonly string[]][]) {
      if (await tx.dictionaryItem.findFirst({ where: { kind } })) continue;
      await tx.dictionaryItem.createMany({
        data: names.map((name, i) => ({ tenantId: tenant.id, kind, name, sortOrder: (i + 1) * 10 })),
      });
    }

    if (!(await tx.branch.findFirst())) {
      await tx.branch.create({ data: { tenantId: tenant.id, name: 'Asosiy filial', code: 'ASOSIY' } });
    }

    if (!(await tx.user.findFirst({ where: { phone } }))) {
      await tx.user.create({
        data: {
          tenantId: tenant.id,
          fullName: 'Direktor',
          phone,
          passwordHash: await hash(password),
          roles: { create: { tenantId: tenant.id, roleId: owner.id } },
        },
      });
      console.log(`owner yaratildi: ${phone}`);
    }
  });

  console.log(`seed ok: tenant=${slug}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

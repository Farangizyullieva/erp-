import type { LedgerEntry, Prisma } from '@prisma/client';
import type { Tx } from '../../common/db/prisma.service';

export interface NewEntry {
  studentId: string;
  enrollmentId?: string | null;
  entryType: 'payment' | 'charge' | 'refund' | 'adjustment';
  /** Ishorali, tiyinda: tushum +, yechim − */
  amount: bigint;
  occurredAt: Date;
  sourceType: 'subscription' | 'manual';
  sourceId?: string | null;
  reversesEntryId?: string | null;
  chargeRevision?: number;
  method?: string | null;
  comment?: string | null;
  receiptNumber?: number;
  createdBy?: string | null;
}

/**
 * Ledger'ga yozuv qo'shadi va balans keshini shu transaction'da ATOMIK ifoda bilan yangilaydi
 * (cached_balance = cached_balance + amount) — o'qib-qayta yozish parallel to'lovlarda summani yo'qotardi (M6.4).
 */
export async function postEntry(tx: Tx, tenantId: string, entry: NewEntry): Promise<LedgerEntry> {
  const created = await tx.ledgerEntry.create({ data: { tenantId, ...entry } satisfies Prisma.LedgerEntryUncheckedCreateInput });
  await tx.$executeRaw`UPDATE students SET cached_balance = cached_balance + ${entry.amount} WHERE id = ${entry.studentId}::uuid`;
  return created;
}

/** Sanaga `months` oy qo'shadi; kun oyda bo'lmasa oxirgi kunga tushadi (31-yanvar + 1 oy = 28/29-fevral) */
export function addMonths(date: Date, months: number): Date {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return target;
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Oylik abonement (biznes qoidasi): o'quvchi har doim bir oylik abonement sotib oladi.
 *  - Abonement oyi a'zolik boshlangan kundan sanaladi (15-oktabr → 14-noyabr, keyingisi 15-noyabrdan).
 *  - Har bir boshlangan oy uchun bir marta to'liq oylik narx yechiladi — darsga kelgan-kelmaganidan qat'i nazar.
 *  - Pul qaytarilmaydi va ishlatilmagan darslar keyingi oyga o'tmaydi: davomat, dars bekor qilinishi yoki
 *    oy o'rtasida guruhdan chiqish yechimga ta'sir qilmaydi.
 *  - Faqat ishlayotgan (active) guruh uchun; to'xtatilgan guruhda yangi oy boshlanmaydi.
 * Idempotent: (a'zolik, oy raqami) bo'yicha unique index — job ikki marta ishlasa ham bitta yechim (M6.6).
 * Qaytaradi: yangi yozilgan yechimlar soni.
 */
export async function chargeSubscriptions(tx: Tx, tenantId: string, today: string, only?: { enrollmentId?: string; studyUnitId?: string }): Promise<number> {
  const todayDate = new Date(`${today}T00:00:00Z`);
  const enrollments = await tx.enrollment.findMany({
    where: { id: only?.enrollmentId, studyUnitId: only?.studyUnitId, startDate: { lte: todayDate }, studyUnit: { status: 'active' } },
    select: { id: true, studentId: true, startDate: true, endDate: true, priceAmount: true, studyUnit: { select: { name: true } } },
  });
  if (!enrollments.length) return 0;
  const existing = await tx.ledgerEntry.findMany({
    where: { sourceType: 'subscription', sourceId: { in: enrollments.map((e) => e.id) }, entryType: 'charge', reversesEntryId: null },
    select: { sourceId: true, chargeRevision: true },
  });
  const charged = new Set(existing.map((c) => `${c.sourceId}:${c.chargeRevision}`));

  let created = 0;
  for (const e of enrollments) {
    if (e.priceAmount <= 0n) continue;
    // 1-oy = a'zolik boshlangan kundan; har keyingi oy shu sananing navbatdagi oyi
    for (let period = 1; period <= 120; period++) {
      const start = addMonths(e.startDate, period - 1);
      if (start > todayDate || (e.endDate && start > e.endDate)) break;
      if (charged.has(`${e.id}:${period}`)) continue;
      const until = new Date(addMonths(e.startDate, period).getTime() - 86_400_000);
      await postEntry(tx, tenantId, {
        studentId: e.studentId,
        enrollmentId: e.id,
        entryType: 'charge',
        amount: -e.priceAmount,
        occurredAt: new Date(start.getTime() + 7 * 3_600_000), // davr boshi, Toshkent bo'yicha tush
        sourceType: 'subscription',
        sourceId: e.id,
        chargeRevision: period,
        comment: `${e.studyUnit.name}: ${iso(start)} – ${iso(until)}`,
      });
      created++;
    }
  }
  return created;
}

/**
 * Xato bilan qo'shilgan a'zolikni bekor qilish: uning abonement yechimlari storno qilinadi (ledger'da iz qoladi).
 * Faqat davomati yo'q a'zolik butunlay olib tashlanganda chaqiriladi — o'qigan o'quvchiga pul qaytarilmaydi.
 */
export async function reverseSubscriptionCharges(tx: Tx, tenantId: string, enrollmentId: string, createdBy: string | null): Promise<void> {
  const entries = await tx.ledgerEntry.findMany({ where: { sourceType: 'subscription', sourceId: enrollmentId, entryType: 'charge' } });
  const reversed = new Set(entries.flatMap((c) => (c.reversesEntryId ? [c.reversesEntryId] : [])));
  for (const c of entries) {
    if (c.reversesEntryId || reversed.has(c.id)) continue;
    await postEntry(tx, tenantId, {
      studentId: c.studentId,
      entryType: 'charge',
      amount: -c.amount,
      occurredAt: new Date(),
      sourceType: 'subscription',
      sourceId: enrollmentId,
      reversesEntryId: c.id,
      chargeRevision: c.chargeRevision,
      comment: "A'zolik bekor qilindi",
      createdBy,
    });
  }
}

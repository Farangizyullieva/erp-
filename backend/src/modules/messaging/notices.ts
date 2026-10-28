import type { AttendanceStatus } from '@prisma/client';
import type { Tx } from '../../common/db/prisma.service';
import { addMonths } from '../finance/ledger';

// Avtomatik xabarlar: to'lov eslatmasi, darsga kelmaganlik xabari va to'lov cheki.
// Hammasi navbatga (message_log) yoziladi — yuborishni worker bajaradi. Faqat botga ulangan ota-onalarga boradi.

/** Navbatdagi to'lovdan necha kun oldin eslatiladi */
export const PAYMENT_REMINDER_DAYS = 3;
/** Xato belgilangan davomatni tuzatishga vaqt: xabar shu daqiqadan keyin ketadi */
export const ABSENCE_DELAY_MINUTES = 10;

const sum = (tiyin: bigint): string => String(Math.round(Math.abs(Number(tiyin)) / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const dmy = (d: Date): string => `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
const METHODS = {
  uz: { cash: 'naqd', card: 'karta', payme: 'Payme', click: 'Click', bank: "bank o'tkazmasi" },
  ru: { cash: 'наличные', card: 'карта', payme: 'Payme', click: 'Click', bank: 'банковский перевод' },
} as const;

const balanceLine = {
  uz: (b: bigint) => (b < 0n ? `⚠️ Qarzdorlik: ${sum(b)} so'm` : `💰 Balansda: ${sum(b)} so'm`),
  ru: (b: bigint) => (b < 0n ? `⚠️ Задолженность: ${sum(b)} сум` : `💰 На балансе: ${sum(b)} сум`),
};

export const NOTICE_TEXT = {
  uz: {
    payment: (student: string, group: string, date: string, price: bigint, balance: bigint, center: string) =>
      `🔔 To'lov eslatmasi\n\n${student} — «${group}» guruhi.\n${date} kuni yangi o'quv oyi boshlanadi.\nOylik to'lov: ${sum(price)} so'm\n${balanceLine.uz(balance)}\n\nIltimos, to'lovni o'z vaqtida amalga oshiring.\n${center}`,
    absence: (student: string, group: string, date: string, time: string, center: string) =>
      `❗️ ${student} bugun darsga kelmadi\n\n«${group}» guruhi, ${date}, soat ${time}.\nSababini bilsangiz, o'quv markazga xabar bering.\n${center}`,
    receipt: (student: string, amount: bigint, method: string, date: string, number: string, balance: bigint, center: string) =>
      `✅ To'lov qabul qilindi\n\nO'quvchi: ${student}\nSumma: ${sum(amount)} so'm (${method})\nSana: ${date}\nChek №${number}\n${balanceLine.uz(balance)}\n\nRahmat!\n${center}`,
  },
  ru: {
    payment: (student: string, group: string, date: string, price: bigint, balance: bigint, center: string) =>
      `🔔 Напоминание об оплате\n\n${student} — группа «${group}».\n${date} начинается новый учебный месяц.\nОплата за месяц: ${sum(price)} сум\n${balanceLine.ru(balance)}\n\nПожалуйста, внесите оплату вовремя.\n${center}`,
    absence: (student: string, group: string, date: string, time: string, center: string) =>
      `❗️ ${student} сегодня не пришёл(а) на урок\n\nГруппа «${group}», ${date}, ${time}.\nЕсли знаете причину, сообщите в учебный центр.\n${center}`,
    receipt: (student: string, amount: bigint, method: string, date: string, number: string, balance: bigint, center: string) =>
      `✅ Оплата принята\n\nУченик: ${student}\nСумма: ${sum(amount)} сум (${method})\nДата: ${date}\nЧек №${number}\n${balanceLine.ru(balance)}\n\nСпасибо!\n${center}`,
  },
} as const;
const lang = (code: string): 'uz' | 'ru' => (code === 'ru' ? 'ru' : 'uz');

/** Chek raqami ko'rinishi: 000123 */
export const receiptNo = (n: number | null, id: string): string => (n ? String(n).padStart(6, '0') : id.slice(0, 8).toUpperCase());

/** Sozlamalar; satr yo'q bo'lsa — standart qiymatlar (avtomatik xabarlar yoqilgan, haftalik hisobot o'chiq) */
export async function noticeSettings(tx: Tx, tenantId: string) {
  const s = await tx.tenantSetting.findUnique({ where: { tenantId } });
  return {
    weeklyReportEnabled: s?.weeklyReportEnabled ?? false,
    paymentReminderEnabled: s?.paymentReminderEnabled ?? true,
    absenceNoticeEnabled: s?.absenceNoticeEnabled ?? true,
    receiptEnabled: s?.receiptEnabled ?? true,
    paymentReminderLastDate: s?.paymentReminderLastDate ?? null,
  };
}

/** O'quvchining botga ulangan aloqa shaxslariga xabarni navbatga qo'yadi; qo'yilgan xabarlar sonini qaytaradi */
export async function enqueue(
  tx: Tx,
  tenantId: string,
  studentId: string,
  body: string,
  kind: string,
  options: { createdBy?: string | null; refId?: string; critical?: boolean; delayMinutes?: number } = {},
): Promise<number> {
  const links = await tx.messengerLink.findMany({
    where: { blockedAt: null, contactPerson: { receivesNotifications: true, client: { student: { id: studentId } } } },
    select: { contactPersonId: true, externalChatId: true },
  });
  if (links.length) {
    await tx.messageLog.createMany({
      data: links.map((l) => ({
        tenantId,
        studentId,
        contactPersonId: l.contactPersonId,
        chatId: l.externalChatId,
        kind,
        body,
        refId: options.refId,
        critical: options.critical ?? false,
        createdBy: options.createdBy ?? null,
        nextAttemptAt: new Date(Date.now() + (options.delayMinutes ?? 0) * 60_000),
      })),
    });
  }
  return links.length;
}

/**
 * Davomat saqlangandan keyin: bugungi darsga sababsiz kelmaganlar ota-onasiga xabar.
 * Belgi tuzatilsa (kelmadi → keldi) hali yuborilmagan xabar bekor qilinadi; bitta dars uchun xabar bir marta ketadi.
 */
export async function queueAbsenceNotices(
  tx: Tx,
  tenantId: string,
  lesson: { id: string; date: Date; startAt: Date; studyUnit: { name: string } },
  entries: { studentId: string; status: AttendanceStatus }[],
  today: string,
  timeZone: string,
): Promise<number> {
  if (lesson.date.toISOString().slice(0, 10) !== today) return 0;
  const present = entries.filter((e) => e.status !== 'absent_unexcused').map((e) => e.studentId);
  if (present.length) await tx.messageLog.deleteMany({ where: { kind: 'absence', refId: lesson.id, status: 'queued', studentId: { in: present } } });
  const absent = entries.filter((e) => e.status === 'absent_unexcused').map((e) => e.studentId);
  if (!absent.length || !(await noticeSettings(tx, tenantId)).absenceNoticeEnabled) return 0;

  const already = new Set((await tx.messageLog.findMany({ where: { kind: 'absence', refId: lesson.id, studentId: { in: absent } }, select: { studentId: true } })).map((m) => m.studentId));
  const students = await tx.student.findMany({ where: { id: { in: absent.filter((id) => !already.has(id)) } }, select: { id: true, notificationLanguage: true, client: { select: { fullName: true } } } });
  if (!students.length) return 0;
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } });
  const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(lesson.startAt);
  let queued = 0;
  for (const s of students) {
    queued += await enqueue(tx, tenantId, s.id, NOTICE_TEXT[lang(s.notificationLanguage)].absence(s.client.fullName, lesson.studyUnit.name, dmy(lesson.date), time, tenant.name), 'absence', { refId: lesson.id, delayMinutes: ABSENCE_DELAY_MINUTES });
  }
  return queued;
}

/** To'lov qabul qilinganda ota-onaga Telegram chek */
export async function queueReceipt(tx: Tx, tenantId: string, entry: { id: string; studentId: string; amount: bigint; method: string | null; receiptNumber: number | null }, date: string, createdBy: string | null): Promise<number> {
  if (!(await noticeSettings(tx, tenantId)).receiptEnabled) return 0;
  const student = await tx.student.findUniqueOrThrow({ where: { id: entry.studentId }, select: { cachedBalance: true, notificationLanguage: true, client: { select: { fullName: true } } } });
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } });
  const l = lang(student.notificationLanguage);
  const method = METHODS[l][entry.method as keyof (typeof METHODS)['uz']] ?? entry.method ?? '';
  const body = NOTICE_TEXT[l].receipt(student.client.fullName, entry.amount, method, dmy(new Date(`${date}T00:00:00Z`)), receiptNo(entry.receiptNumber, entry.id), student.cachedBalance, tenant.name);
  // Chek — tranzaksion xabar: kunlik limit va vaqt oynasi uni ushlab qolmaydi
  return enqueue(tx, tenantId, entry.studentId, body, 'receipt', { refId: entry.id, critical: true, createdBy });
}

/**
 * To'lov eslatmasi: yangi abonement oyi roppa-rosa `PAYMENT_REMINDER_DAYS` kundan keyin boshlanadigan va
 * balansi shu oyga yetmaydigan o'quvchilar. Bir kunda bir marta chaqiriladi (worker belgi qo'yadi).
 */
export async function queuePaymentReminders(tx: Tx, tenantId: string, today: string): Promise<number> {
  const target = new Date(new Date(`${today}T00:00:00Z`).getTime() + PAYMENT_REMINDER_DAYS * 86_400_000);
  const enrollments = await tx.enrollment.findMany({
    where: { startDate: { lt: target }, OR: [{ endDate: null }, { endDate: { gte: target } }], studyUnit: { status: 'active' }, priceAmount: { gt: 0 }, student: { status: { notIn: ['archived', 'finished'] }, mergedIntoId: null } },
    select: { id: true, startDate: true, priceAmount: true, studyUnit: { select: { name: true } }, student: { select: { id: true, cachedBalance: true, notificationLanguage: true, client: { select: { fullName: true } } } } },
  });
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } });
  let queued = 0;
  for (const e of enrollments) {
    // Keyingi oy boshi aynan maqsad kuniga to'g'ri keladimi
    let k = 1;
    while (addMonths(e.startDate, k) < target && k < 240) k++;
    if (addMonths(e.startDate, k).getTime() !== target.getTime()) continue;
    // Balans keyingi oyni qoplasa — bezovta qilinmaydi
    if (e.student.cachedBalance >= e.priceAmount) continue;
    if (await tx.messageLog.findFirst({ where: { kind: 'payment_reminder', refId: e.id, createdAt: { gte: new Date(Date.now() - 5 * 86_400_000) } }, select: { id: true } })) continue;
    const body = NOTICE_TEXT[lang(e.student.notificationLanguage)].payment(e.student.client.fullName, e.studyUnit.name, dmy(target), e.priceAmount, e.student.cachedBalance, tenant.name);
    queued += await enqueue(tx, tenantId, e.student.id, body, 'payment_reminder', { refId: e.id });
  }
  return queued;
}

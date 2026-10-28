import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContextStore } from '../../common/context/request-context';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { AppError } from '../../common/http/app-error';
import { studentScope } from '../students/students.service';
import { MESSENGER, MessengerProvider } from './messenger.provider';
import { enqueue, noticeSettings } from './notices';

const LINK_TTL_DAYS = 7;
/** Bitta o'quvchi bo'yicha qarz eslatmasi shu muddatda bir martadan ko'p yuborilmaydi */
export const DEBT_REMINDER_COOLDOWN_HOURS = 24;
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const notConfigured = (): AppError => new AppError('TELEGRAM_NOT_CONFIGURED', 409, 'Telegram bot ulanmagan. Administrator bot tokenini sozlashi kerak');

const money = (tiyin: bigint): string => `${String(Math.round(Math.abs(Number(tiyin)) / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;

const TEXT = {
  uz: {
    linked: (student: string) => `✅ Ulandi. Endi ${student} bo'yicha xabarlar shu yerga keladi.`,
    invalid: "Havola yaroqsiz yoki muddati o'tgan. O'quv markaz administratoridan yangi havola so'rang.",
    hello: "Assalomu alaykum! Bu o'quv markazining xabarnoma boti. Ulanish uchun administrator bergan havola orqali kiring.",
    title: (student: string) => `📊 Haftalik hisobot — ${student}`,
    period: (from: string, to: string) => `${from} – ${to}`,
    balancePositive: (sum: string) => `💰 Balansda ${sum} so'm bor`,
    balanceDebt: (sum: string) => `⚠️ Qarzdorlik: ${sum} so'm`,
    balanceZero: "💰 Qarzdorlik yo'q",
    status: { new: 'Hali guruhga biriktirilmagan', active: "O'qiyapti", paused: "O'qish to'xtatilgan", finished: 'Kursni tugatgan', archived: 'Arxivda' },
    statusLine: (status: string) => `🎓 Holat: ${status}`,
    attendance: (came: number, total: number) => `✅ Bu hafta ${total} ta darsdan ${came} tasiga keldi`,
    noLessons: "📅 Bu hafta dars bo'lmadi",
    lessonsLeft: (n: number) => `   (yana ${n} oyga yetadi)`,
    lessonsDebt: (n: number) => `   (${n} oylik abonement uchun)`,
    debt: (student: string, sum: string, center: string) => `🔔 Hurmatli ota-ona!\n\n${student} bo'yicha ${sum} so'm qarzdorlik mavjud.\nIltimos, to'lovni yaqin kunlarda amalga oshiring.\n\nRahmat!\n${center}`,
  },
  ru: {
    linked: (student: string) => `✅ Подключено. Теперь сообщения по ученику ${student} будут приходить сюда.`,
    invalid: 'Ссылка недействительна или устарела. Попросите новую у администратора учебного центра.',
    hello: 'Здравствуйте! Это бот уведомлений учебного центра. Чтобы подключиться, перейдите по ссылке от администратора.',
    title: (student: string) => `📊 Еженедельный отчёт — ${student}`,
    period: (from: string, to: string) => `${from} – ${to}`,
    balancePositive: (sum: string) => `💰 На балансе ${sum} сум`,
    balanceDebt: (sum: string) => `⚠️ Задолженность: ${sum} сум`,
    balanceZero: '💰 Задолженности нет',
    status: { new: 'Пока не в группе', active: 'Учится', paused: 'Обучение приостановлено', finished: 'Курс окончен', archived: 'В архиве' },
    statusLine: (status: string) => `🎓 Статус: ${status}`,
    attendance: (came: number, total: number) => `✅ На этой неделе посетил(а) ${came} из ${total} уроков`,
    noLessons: '📅 На этой неделе уроков не было',
    lessonsLeft: (n: number) => `   (хватит ещё на ${n} мес.)`,
    lessonsDebt: (n: number) => `   (за ${n} мес. абонемента)`,
    debt: (student: string, sum: string, center: string) => `🔔 Уважаемые родители!\n\nПо ученику ${student} имеется задолженность: ${sum} сум.\nПожалуйста, внесите оплату в ближайшие дни.\n\nСпасибо!\n${center}`,
  },
} as const;
type Lang = keyof typeof TEXT;
const lang = (code: string): Lang => (code === 'ru' ? 'ru' : 'uz');
const dmy = (d: Date): string => `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

@Injectable()
export class MessagingService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
    @Inject(MESSENGER) private readonly messenger: MessengerProvider | null,
  ) {}

  async status() {
    const auth = RequestContextStore.auth();
    const username = this.messenger ? await this.messenger.username().catch(() => null) : null;
    return this.db.tx(async (tx) => {
      const settings = await noticeSettings(tx, auth.tenantId);
      return {
        // configured: token berilgan; connected: token haqiqatan ishlayapti (getMe javob berdi)
        configured: this.messenger !== null,
        connected: username !== null,
        bot_username: username,
        linked_contacts: await tx.messengerLink.count({ where: { blockedAt: null } }),
        weekly_report_enabled: settings.weeklyReportEnabled,
        payment_reminder_enabled: settings.paymentReminderEnabled,
        absence_notice_enabled: settings.absenceNoticeEnabled,
        receipt_enabled: settings.receiptEnabled,
      };
    });
  }

  setWeeklyReport(enabled: boolean) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      await tx.tenantSetting.upsert({
        where: { tenantId: auth.tenantId },
        update: { weeklyReportEnabled: enabled },
        create: { tenantId: auth.tenantId, weeklyReportEnabled: enabled },
      });
      await this.audit.write(tx, auth.tenantId, { action: 'messaging.weekly_report_toggled', entityType: 'tenant_setting', newValue: { enabled } });
      return { weekly_report_enabled: enabled };
    });
  }

  /** Avtomatik xabarlarni yoqish/o'chirish: faqat berilgan kalitlar o'zgaradi */
  setSettings(input: { weekly_report_enabled?: boolean; payment_reminder_enabled?: boolean; absence_notice_enabled?: boolean; receipt_enabled?: boolean }) {
    const auth = RequestContextStore.auth();
    const data = { weeklyReportEnabled: input.weekly_report_enabled, paymentReminderEnabled: input.payment_reminder_enabled, absenceNoticeEnabled: input.absence_notice_enabled, receiptEnabled: input.receipt_enabled };
    return this.db.tx(async (tx) => {
      await tx.tenantSetting.upsert({ where: { tenantId: auth.tenantId }, update: data, create: { tenantId: auth.tenantId, ...data } });
      await this.audit.write(tx, auth.tenantId, { action: 'messaging.settings_changed', entityType: 'tenant_setting', newValue: input });
      const s = await noticeSettings(tx, auth.tenantId);
      return { weekly_report_enabled: s.weeklyReportEnabled, payment_reminder_enabled: s.paymentReminderEnabled, absence_notice_enabled: s.absenceNoticeEnabled, receipt_enabled: s.receiptEnabled };
    });
  }

  /** Ota-onaga beriladigan bir martalik havola: t.me/<bot>?start=<token>. Token tenant prefiksi bilan — bot kimligini shundan biladi */
  async createLink(studentId: string, contactId: string) {
    const auth = RequestContextStore.auth();
    if (!this.messenger) throw notConfigured();
    const username = await this.messenger.username().catch(() => {
      throw notConfigured();
    });
    if (!auth.permissions['student.view_contacts']) throw AppError.forbidden();
    const token = `${auth.tenantId.replace(/-/g, '')}_${randomBytes(15).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + LINK_TTL_DAYS * 86_400_000);
    return this.db.tx(async (tx) => {
      const student = await tx.student.findFirst({
        where: { AND: [{ id: studentId }, studentScope(auth, 'student.update')] },
        select: { client: { select: { contactPersons: { where: { id: contactId }, select: { id: true } } } } },
      });
      if (!student?.client.contactPersons.length) throw AppError.notFound('Aloqa shaxsi');
      await tx.messengerLinkToken.create({ data: { tokenHash: sha256(token), tenantId: auth.tenantId, contactPersonId: contactId, expiresAt } });
      return { url: `https://t.me/${username}?start=${token}`, expires_at: expiresAt };
    });
  }

  /** Botga kelgan xabar. `/start <token>` — ulash; boshqa hammasiga qisqa tushuntirish. Javob matni qaytadi. */
  async handleIncoming(chatId: string, text: string): Promise<string> {
    const token = /^\/start\s+([0-9a-f]{32}_[A-Za-z0-9_-]{10,40})$/.exec(text.trim())?.[1];
    if (!token) return `${TEXT.uz.hello}\n\n${TEXT.ru.hello}`;
    const hex = token.slice(0, 32);
    const tenantId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

    return this.db.tx(async (tx) => {
      const row = await tx.messengerLinkToken.findUnique({
        where: { tokenHash: sha256(token) },
        include: { contactPerson: { include: { client: { include: { student: true } } } } },
      });
      // Ishlatilgan yoki eskirgan havola ikkinchi marta ishlamaydi — uni qo'lga kiritgan begona odam ulanib ololmaydi
      if (!row || row.usedAt || row.expiresAt <= new Date()) return `${TEXT.uz.invalid}\n\n${TEXT.ru.invalid}`;
      await tx.messengerLinkToken.update({ where: { tokenHash: row.tokenHash }, data: { usedAt: new Date() } });
      await tx.messengerLink.upsert({
        where: { contactPersonId_channel_externalChatId: { contactPersonId: row.contactPersonId, channel: 'telegram', externalChatId: chatId } },
        update: { blockedAt: null, linkedAt: new Date() },
        create: { tenantId, contactPersonId: row.contactPersonId, externalChatId: chatId },
      });
      await this.audit.write(tx, tenantId, { action: 'messaging.telegram_linked', entityType: 'student', entityId: row.contactPerson.client.student?.id, actorId: undefined, newValue: { full_name: row.contactPerson.fullName } });
      const l = lang(row.contactPerson.client.student?.notificationLanguage ?? 'uz');
      return TEXT[l].linked(row.contactPerson.client.fullName);
    }, tenantId);
  }

  /** O'quvchining ulangan aloqa shaxslariga xabar. Navbatga yoziladi — yuborishni worker bajaradi (outbox) */
  sendToStudent(studentId: string, text: string) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const student = await tx.student.findFirst({ where: { AND: [{ id: studentId }, studentScope(auth, 'student.view')] }, select: { id: true } });
      if (!student) throw AppError.notFound("O'quvchi");
      const queued = await this.enqueue(tx, auth.tenantId, studentId, text, 'manual', auth.userId);
      if (queued === 0) throw new AppError('NO_RECIPIENTS', 409, "Bu o'quvchining Telegram'ga ulangan aloqa shaxsi yo'q");
      await this.audit.write(tx, auth.tenantId, { action: 'messaging.message_queued', entityType: 'student', entityId: studentId, newValue: { recipients: queued, length: text.length } });
      return { queued };
    });
  }

  /**
   * Qarzdorlarga "qarzingizni to'lang" eslatmasi. `studentIds` berilmasa — ko'rinadigan barcha qarzdorlarga.
   * `dryRun` — hech narsa yubormaydi, faqat nechta odamga yetib borishini hisoblaydi (tasdiqlash oynasi uchun).
   */
  debtReminders(input: { studentIds?: string[]; branchId?: string; dryRun: boolean }) {
    const auth = RequestContextStore.auth();
    if (!input.dryRun && !this.messenger) throw notConfigured();
    return this.db.tx(async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { name: true } });
      const debtors = await tx.student.findMany({
        where: { AND: [studentScope(auth, 'student.view'), { id: input.studentIds ? { in: input.studentIds } : undefined, branchId: input.branchId, cachedBalance: { lt: 0 }, status: { not: 'archived' }, mergedIntoId: null }] },
        select: { id: true, cachedBalance: true, notificationLanguage: true, client: { select: { fullName: true } } },
        take: 2000,
      });
      const ids = debtors.map((d) => d.id);
      const linked = new Set(
        (await tx.messengerLink.findMany({ where: { blockedAt: null, contactPerson: { receivesNotifications: true, client: { student: { id: { in: ids } } } } }, select: { contactPerson: { select: { client: { select: { student: { select: { id: true } } } } } } } })).flatMap((l) =>
          l.contactPerson.client.student ? [l.contactPerson.client.student.id] : [],
        ),
      );
      const since = new Date(Date.now() - DEBT_REMINDER_COOLDOWN_HOURS * 3_600_000);
      const recent = new Set((await tx.messageLog.findMany({ where: { kind: 'debt_reminder', studentId: { in: ids }, createdAt: { gte: since }, status: { not: 'failed' } }, select: { studentId: true }, distinct: ['studentId'] })).flatMap((r) => (r.studentId ? [r.studentId] : [])));
      const targets = debtors.filter((d) => linked.has(d.id) && !recent.has(d.id));
      const result = {
        debtors: debtors.length,
        will_receive: targets.length,
        not_linked: debtors.filter((d) => !linked.has(d.id)).length,
        recently_reminded: debtors.filter((d) => linked.has(d.id) && recent.has(d.id)).length,
        total_debt: -Number(debtors.reduce((sum, d) => sum + d.cachedBalance, 0n)),
        sample: TEXT.uz.debt('Karimov Aziz', money(-45_000_000n), tenant.name),
        bot_configured: this.messenger !== null,
      };
      if (input.dryRun) return { ...result, queued: 0 };
      let queued = 0;
      for (const d of targets) queued += await this.enqueue(tx, auth.tenantId, d.id, TEXT[lang(d.notificationLanguage)].debt(d.client.fullName, money(d.cachedBalance), tenant.name), 'debt_reminder', auth.userId);
      if (targets.length) await this.audit.write(tx, auth.tenantId, { action: 'messaging.debt_reminders_queued', entityType: 'message', newValue: { students: targets.length, messages: queued } });
      return { ...result, queued };
    });
  }

  weeklyPreview(studentId: string) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const student = await tx.student.findFirst({ where: { AND: [{ id: studentId }, studentScope(auth, 'student.view')] }, select: { id: true } });
      if (!student) throw AppError.notFound("O'quvchi");
      return { text: await this.weeklyReportText(tx, studentId) };
    });
  }

  log() {
    return this.db.tx(async (tx) => {
      const rows = await tx.messageLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
      const contacts = await tx.contactPerson.findMany({ where: { id: { in: rows.flatMap((r) => (r.contactPersonId ? [r.contactPersonId] : [])) } }, select: { id: true, fullName: true } });
      const students = await tx.student.findMany({ where: { id: { in: rows.flatMap((r) => (r.studentId ? [r.studentId] : [])) } }, select: { id: true, client: { select: { fullName: true } } } });
      const contactName = new Map(contacts.map((c) => [c.id, c.fullName]));
      const studentName = new Map(students.map((s) => [s.id, s.client.fullName]));
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        status: r.status,
        error: r.error,
        body: r.body,
        recipient: r.contactPersonId ? (contactName.get(r.contactPersonId) ?? null) : null,
        student: r.studentId ? { id: r.studentId, full_name: studentName.get(r.studentId) ?? '' } : null,
        created_at: r.createdAt,
        sent_at: r.sentAt,
      }));
    });
  }

  /** Haftalik hisobotlarni barcha ulangan ota-onalarga navbatga qo'yadi; qo'yilgan xabarlar sonini qaytaradi */
  async queueWeeklyReports(tx: Tx, tenantId: string): Promise<number> {
    const students = await tx.student.findMany({
      where: { status: { notIn: ['archived', 'finished'] }, mergedIntoId: null, client: { contactPersons: { some: { receivesNotifications: true, messengerLinks: { some: { blockedAt: null } } } } } },
      select: { id: true },
    });
    let total = 0;
    for (const s of students) total += await this.enqueue(tx, tenantId, s.id, await this.weeklyReportText(tx, s.id), 'weekly_report', null);
    return total;
  }

  /**
   * Hisobot faqat tizimda haqiqatan bor ma'lumotdan yig'iladi: haftalik davomat, holat va balans (so'mda va darslarda).
   * Uy vazifasi satri shu modul qurilganda qo'shiladi — raqam o'ylab topilmaydi.
   */
  private async weeklyReportText(tx: Tx, studentId: string): Promise<string> {
    const s = await tx.student.findUniqueOrThrow({
      where: { id: studentId },
      select: { status: true, cachedBalance: true, notificationLanguage: true, client: { select: { fullName: true } }, enrollments: { where: { endDate: null }, select: { priceAmount: true }, take: 1 } },
    });
    const T = TEXT[lang(s.notificationLanguage)];
    const to = new Date();
    const from = new Date(to.getTime() - 6 * 86_400_000);
    const balance = s.cachedBalance > 0n ? T.balancePositive(money(s.cachedBalance)) : s.cachedBalance < 0n ? T.balanceDebt(money(s.cachedBalance)) : T.balanceZero;
    const marks = await tx.attendance.findMany({ where: { studentId, lesson: { date: { gte: new Date(from.toISOString().slice(0, 10)) }, status: { not: 'cancelled' } } }, select: { status: true } });
    const came = marks.filter((m) => m.status === 'present' || m.status === 'late').length;
    // Balans necha oylik abonementga teng
    const price = s.enrollments[0]?.priceAmount ?? 0n;
    const lessons = price > 0n ? Number((s.cachedBalance < 0n ? -s.cachedBalance : s.cachedBalance) / price) : 0;
    const inLessons = lessons > 0 ? (s.cachedBalance > 0n ? T.lessonsLeft(lessons) : s.cachedBalance < 0n ? T.lessonsDebt(lessons) : null) : null;
    return [T.title(s.client.fullName), T.period(dmy(from), dmy(to)), '', marks.length ? T.attendance(came, marks.length) : T.noLessons, T.statusLine(T.status[s.status]), balance, ...(inLessons ? [inLessons] : [])].join('\n');
  }

  private enqueue(tx: Tx, tenantId: string, studentId: string, body: string, kind: string, createdBy: string | null): Promise<number> {
    return enqueue(tx, tenantId, studentId, body, kind, { createdBy });
  }
}

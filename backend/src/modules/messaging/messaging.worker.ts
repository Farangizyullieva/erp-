import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AlertService } from '../../common/alerts/alert.service';
import { PrismaService } from '../../common/db/prisma.service';
import { MessagingService } from './messaging.service';
import { MESSENGER, MessengerError, MessengerProvider } from './messenger.provider';
import { noticeSettings, queuePaymentReminders } from './notices';

const MAX_ATTEMPTS = 3;
const DAILY_LIMIT = 5; // eslatma va marketing xabarlari uchun, bir oluvchiga (TZ M8.3)
const WINDOW = { from: 9, to: 21 }; // oluvchi vaqti bo'yicha yuborish oynasi

/** Tenant vaqt zonasidagi "devor soati" qismlari */
function localParts(now: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), weekday: parts.weekday as string };
}

/** ISO hafta kaliti ("2026-W41") — haftalik hisobot bir haftada bir marta ketishi uchun */
function isoWeek(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const week = Math.ceil(((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Fon ishlari: (1) navbatdagi xabarlarni yuborish, (2) botga kelgan /start'larni qabul qilish, (3) haftalik hisobot.
 * Bitta instans uchun mo'ljallangan (MVP); bir nechta instansda BullMQ navbatiga ko'chiriladi (TZ 10.2).
 */
@Injectable()
export class MessagingWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('MessagingWorker');
  private timers: NodeJS.Timeout[] = [];
  private stopped = false;
  private sending = false;

  constructor(
    private readonly db: PrismaService,
    private readonly messaging: MessagingService,
    @Inject(MESSENGER) private readonly messenger: MessengerProvider | null,
    private readonly alerts: AlertService,
  ) {}

  onModuleInit(): void {
    if (!this.messenger || process.env.NODE_ENV === 'test') return;
    this.timers.push(setInterval(() => void this.sendDue().catch((e) => this.logger.error(e)), 5_000));
    this.timers.push(setInterval(() => void this.weeklyCheck().catch((e) => this.logger.error(e)), 5 * 60_000));
    this.timers.push(setInterval(() => void this.dailyCheck().catch((e) => this.logger.error(e)), 5 * 60_000));
    void this.pollLoop();
    this.logger.log('Telegram worker ishga tushdi');
  }

  onModuleDestroy(): void {
    this.stopped = true;
    this.timers.forEach(clearInterval);
  }

  private async pollLoop(): Promise<void> {
    while (!this.stopped && this.messenger) {
      try {
        for (const message of await this.messenger.poll()) await this.receive(message.chatId, message.text);
      } catch (e) {
        // Tarmoq uzilishi yoki noto'g'ri token: biroz kutib, qayta urinadi — ilovaning qolgan qismi ishlayveradi
        this.logger.warn(e instanceof Error ? e.message : String(e));
        await new Promise((resolve) => setTimeout(resolve, 15_000));
      }
    }
  }

  /** Kelgan xabarni qayta ishlaydi va javobni yuboradi */
  async receive(chatId: string, text: string): Promise<void> {
    const reply = await this.messaging.handleIncoming(chatId, text);
    await this.messenger?.send(chatId, reply).catch((e) => this.logger.warn(e instanceof Error ? e.message : String(e)));
  }

  /** Navbatdagi xabarlarni yuboradi. Provayderga murojaat DB transaction'dan TASHQARIDA (M2.7): sekin javob bazani band qilmaydi */
  async sendDue(now: Date = new Date()): Promise<number> {
    if (!this.messenger || this.sending) return 0;
    this.sending = true;
    let sent = 0;
    try {
      for (const tenant of await this.db.tenant.findMany({ where: { isActive: true }, select: { id: true, timezone: true } })) {
        const local = localParts(now, tenant.timezone);
        const due = await this.db.tx((tx) => tx.messageLog.findMany({ where: { status: 'queued', nextAttemptAt: { lte: now } }, orderBy: { createdAt: 'asc' }, take: 20 }), tenant.id);

        for (const message of due) {
          let update: { status?: string; error?: string | null; attempts?: number; nextAttemptAt?: Date; sentAt?: Date } = {};
          let blocked = false;
          if (!message.critical && (local.hour < WINDOW.from || local.hour >= WINDOW.to)) {
            // Oynadan tashqari: keyingi soatda yana tekshiriladi (tunda bezovta qilinmaydi)
            update = { nextAttemptAt: new Date(now.getTime() + 60 * 60_000) };
          } else if (
            !message.critical &&
            (await this.db.tx((tx) => tx.messageLog.count({ where: { chatId: message.chatId, status: 'sent', critical: false, sentAt: { gte: new Date(now.getTime() - 86_400_000) } } }), tenant.id)) >= DAILY_LIMIT
          ) {
            update = { status: 'failed', error: 'Kunlik limit: bir oluvchiga 5 tadan ortiq xabar yuborilmaydi' };
          } else {
            try {
              await this.messenger.send(message.chatId, message.body);
              update = { status: 'sent', sentAt: now, error: null, attempts: message.attempts + 1 };
              sent++;
            } catch (e) {
              const attempts = message.attempts + 1;
              const permanent = e instanceof MessengerError && e.permanent;
              blocked = e instanceof MessengerError && e.blocked;
              // Bot bloklangani — oddiy holat; boshqa doimiy xato (token, format) — administrator bilishi kerak
              if ((permanent && !blocked) || (!permanent && attempts >= MAX_ATTEMPTS)) {
                this.alerts.send('warning', 'Telegram xabari yuborilmadi', [e instanceof Error ? e.message.slice(0, 300) : 'xato', `Urinishlar: ${attempts}`], 'telegram-send-failed');
              }
              update =
                permanent || attempts >= MAX_ATTEMPTS
                  ? { status: 'failed', attempts, error: e instanceof Error ? e.message.slice(0, 300) : 'xato' }
                  : { attempts, error: e instanceof Error ? e.message.slice(0, 300) : 'xato', nextAttemptAt: new Date(now.getTime() + 2 ** attempts * 60_000) }; // exponential backoff
            }
          }
          await this.db.tx(async (tx) => {
            await tx.messageLog.update({ where: { id: message.id }, data: update });
            if (blocked) await tx.messengerLink.updateMany({ where: { externalChatId: message.chatId }, data: { blockedAt: now } });
          }, tenant.id);
        }
      }
    } finally {
      this.sending = false;
    }
    return sent;
  }

  /** Har kuni 10:00 dan keyin (tenant vaqti), kuniga bir marta: 3 kundan keyin to'lov muddati keladiganlarga eslatma */
  async dailyCheck(now: Date = new Date()): Promise<number> {
    let queued = 0;
    for (const tenant of await this.db.tenant.findMany({ where: { isActive: true }, select: { id: true, timezone: true } })) {
      const local = localParts(now, tenant.timezone);
      if (local.hour < 10) continue;
      queued += await this.db.tx(async (tx) => {
        const settings = await noticeSettings(tx, tenant.id);
        if (settings.paymentReminderLastDate === local.date) return 0;
        // Avval belgi, keyin navbat — bitta transaction: ikki marta yuborilmaydi
        await tx.tenantSetting.upsert({ where: { tenantId: tenant.id }, update: { paymentReminderLastDate: local.date }, create: { tenantId: tenant.id, paymentReminderLastDate: local.date } });
        return settings.paymentReminderEnabled ? queuePaymentReminders(tx, tenant.id, local.date) : 0;
      }, tenant.id);
    }
    if (queued) this.logger.log(`To'lov eslatmasi: ${queued} ta xabar navbatga qo'yildi`);
    return queued;
  }

  /** Yakshanba 18:00 dan keyin (tenant vaqti), haftada bir marta, sozlamada yoqilgan bo'lsa */
  async weeklyCheck(now: Date = new Date()): Promise<number> {
    let queued = 0;
    for (const tenant of await this.db.tenant.findMany({ where: { isActive: true }, select: { id: true, timezone: true } })) {
      const local = localParts(now, tenant.timezone);
      if (local.weekday !== 'Sun' || local.hour < 18) continue;
      const week = isoWeek(local.date);
      queued += await this.db.tx(async (tx) => {
        const settings = await tx.tenantSetting.findUnique({ where: { tenantId: tenant.id } });
        if (!settings?.weeklyReportEnabled || settings.weeklyReportLastWeek === week) return 0;
        // Avval belgi, keyin navbat — bitta transaction: ikki marta yuborilmaydi
        await tx.tenantSetting.update({ where: { tenantId: tenant.id }, data: { weeklyReportLastWeek: week } });
        return this.messaging.queueWeeklyReports(tx, tenant.id);
      }, tenant.id);
    }
    if (queued) this.logger.log(`Haftalik hisobot: ${queued} ta xabar navbatga qo'yildi`);
    return queued;
  }
}

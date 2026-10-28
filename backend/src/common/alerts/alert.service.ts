import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../db/prisma.service';

export type AlertLevel = 'critical' | 'error' | 'warning' | 'info';

const ICON: Record<AlertLevel, string> = { critical: '🚨', error: '❌', warning: '⚠️', info: 'ℹ️' };
const CHAT_KEY = 'alerts.telegram_chat_id';
const REPEAT_MS = 5 * 60_000; // bir xil xabar 5 daqiqada bir martadan ko'p emas
const HOURLY_LIMIT = 30; // xato "bo'roni"da chatni to'ldirib yubormaslik uchun

/**
 * Xato va muhim hodisalarni alohida Telegram botga yuboradi (TZ 16.4: darhol alert).
 * Qoidalar: hech qachon xato tashlamaydi va so'rovni kutdirmaydi (fon ishi); takroriy xabarlar siqiladi;
 * xabarga parol, token, so'rov tanasi kabi maxfiy ma'lumot qo'shilmaydi.
 */
@Injectable()
export class AlertService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Alerts');
  private readonly token: string | undefined;
  private readonly linkCode: string | undefined;
  private readonly env: string;
  private chatId: string | null = null;
  private offset = 0;
  private stopped = false;
  private readonly lastSent = new Map<string, { at: number; skipped: number }>();
  private window = { start: 0, count: 0 };

  constructor(
    config: ConfigService,
    private readonly db: PrismaService,
  ) {
    this.token = config.get<string>('ERROR_TELEGRAM_BOT_TOKEN')?.trim() || undefined;
    this.linkCode = config.get<string>('ALERT_LINK_CODE')?.trim() || undefined;
    this.env = process.env.NODE_ENV ?? 'development';
  }

  get enabled(): boolean {
    return Boolean(this.token) && this.env !== 'test';
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    this.chatId = (await this.db.systemSetting.findUnique({ where: { key: CHAT_KEY } }).catch(() => null))?.value ?? null;
    if (this.chatId) this.send('info', 'Server ishga tushdi', []);
    else this.logger.warn("Xato boti ulangan, lekin oluvchi yo'q: botga ALERT_LINK_CODE bilan /start yuboring");
    void this.listen();
  }

  onModuleDestroy(): void {
    this.stopped = true;
  }

  /** Xabar yuborish. `key` — takrorlarni siqish kaliti (ko'rsatilmasa sarlavha). */
  send(level: AlertLevel, title: string, lines: (string | null | undefined | false)[], key: string = title): void {
    if (!this.enabled || !this.chatId) return;
    const now = Date.now();
    const last = this.lastSent.get(key);
    if (last && now - last.at < REPEAT_MS) {
      last.skipped++;
      return;
    }
    if (now - this.window.start > 3_600_000) this.window = { start: now, count: 0 };
    if (++this.window.count > HOURLY_LIMIT) return;
    this.lastSent.set(key, { at: now, skipped: 0 });
    if (this.lastSent.size > 500) this.lastSent.clear();

    const repeated = last?.skipped ? `(oxirgi xabardan beri yana ${last.skipped} marta takrorlandi)` : null;
    const limit = this.window.count === HOURLY_LIMIT ? "⏸ Soatlik limitga yetildi — keyingi soatgacha xabar yuborilmaydi" : null;
    const text = [`${ICON[level]} ${title}`, ...lines.filter(Boolean), repeated, limit, `— ${this.env} · ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`].filter(Boolean).join('\n');
    void this.call('sendMessage', { chat_id: this.chatId, text: text.slice(0, 3900), link_preview_options: { is_disabled: true } }).catch((e) => this.logger.warn(`Alert yuborilmadi: ${e instanceof Error ? e.message : e}`));
  }

  /** Botga kelgan xabarlar: to'g'ri kod bilan /start yuborgan chat oluvchi bo'ladi */
  private async listen(): Promise<void> {
    while (!this.stopped) {
      try {
        const updates = await this.call<{ update_id: number; message?: { text?: string; chat: { id: number; type: string } } }[]>('getUpdates', { offset: this.offset, timeout: 25, allowed_updates: ['message'] }, 35_000);
        for (const update of updates) {
          this.offset = update.update_id + 1;
          const message = update.message;
          if (!message?.text) continue;
          const chat = String(message.chat.id);
          const code = /^\/start\s+(\S+)$/.exec(message.text.trim())?.[1];
          if (this.linkCode && code === this.linkCode) {
            this.chatId = chat;
            await this.db.systemSetting.upsert({ where: { key: CHAT_KEY }, update: { value: chat }, create: { key: CHAT_KEY, value: chat } });
            await this.call('sendMessage', { chat_id: chat, text: "✅ Ulandi. Endi EduCRM'dagi xatolar va muhim hodisalar shu yerga keladi." });
          } else if (chat !== this.chatId) {
            // Kodsiz yoki noto'g'ri kod: begona odam xato xabarlarini ola olmaydi
            await this.call('sendMessage', { chat_id: chat, text: "Bu bot faqat tizim administratori uchun. Ulanish uchun maxsus havola kerak." });
          }
        }
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 20_000));
      }
    }
  }

  private async call<T>(method: string, body: object, timeoutMs = 10_000): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!json.ok) throw new Error(json.description ?? `HTTP ${res.status}`);
    return json.result as T;
  }
}

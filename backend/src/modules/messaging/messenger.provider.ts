import { Logger } from '@nestjs/common';

export const MESSENGER = Symbol('MESSENGER');

export interface IncomingMessage {
  chatId: string;
  text: string;
}

export class MessengerError extends Error {
  constructor(
    message: string,
    /** Qayta urinish foydasiz (chat topilmadi, matn noto'g'ri) */
    readonly permanent: boolean,
    /** Foydalanuvchi botni bloklagan yoki o'chirgan */
    readonly blocked = false,
  ) {
    super(message);
  }
}

/**
 * Provayder abstraksiyasi (TZ 12): biznes logika Telegram SDK/API'ni bilmaydi.
 * Boshqa kanal (WhatsApp, SMS) qo'shish — shu interfeysning yana bitta adapteri.
 */
export interface MessengerProvider {
  /** Bot nomi — ulash havolasini yasash uchun */
  username(): Promise<string>;
  send(chatId: string, text: string): Promise<void>;
  /** Yangi kelgan xabarlar (long polling); bo'sh ro'yxat ham normal */
  poll(): Promise<IncomingMessage[]>;
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export class TelegramProvider implements MessengerProvider {
  private readonly logger = new Logger('Telegram');
  private offset = 0;
  private name: string | null = null;

  constructor(private readonly token: string) {}

  async username(): Promise<string> {
    this.name ??= (await this.call<{ username: string }>('getMe', {})).username;
    return this.name;
  }

  async send(chatId: string, text: string): Promise<void> {
    // parse_mode berilmaydi: matn oddiy tekst sifatida ketadi, foydalanuvchi kiritgan belgi formatlashni buzmaydi
    await this.call('sendMessage', { chat_id: chatId, text, link_preview_options: { is_disabled: true } });
  }

  async poll(): Promise<IncomingMessage[]> {
    const updates = await this.call<{ update_id: number; message?: { text?: string; chat: { id: number; type: string } } }[]>(
      'getUpdates',
      { offset: this.offset, timeout: 25, allowed_updates: ['message'] },
      35_000,
    );
    const messages: IncomingMessage[] = [];
    for (const update of updates) {
      this.offset = update.update_id + 1;
      // Faqat shaxsiy chat: guruhga qo'shilgan bot orqali begona odam ulanib qolmasligi uchun
      if (update.message?.text && update.message.chat.type === 'private') {
        messages.push({ chatId: String(update.message.chat.id), text: update.message.text });
      }
    }
    return messages;
  }

  private async call<T>(method: string, body: object, timeoutMs = 10_000): Promise<T> {
    let res: Response;
    try {
      // Manzil qat'iy: foydalanuvchi kiritgan URL'ga murojaat yo'q (SSRF emas). Token log'ga yozilmaydi.
      res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new MessengerError(`Telegram bilan aloqa yo'q: ${e instanceof Error ? e.name : 'error'}`, false);
    }
    const json = (await res.json().catch(() => ({ ok: false }))) as TelegramResponse<T>;
    if (json.ok && json.result !== undefined) return json.result;
    const code = json.error_code ?? res.status;
    if (code === 401) this.logger.error("Bot token noto'g'ri (401)");
    // 403: bot bloklangan; 400: chat topilmadi / matn noto'g'ri — qayta urinish foydasiz. 429 va 5xx — vaqtinchalik.
    throw new MessengerError(json.description ?? `Telegram xatosi ${code}`, code === 400 || code === 401 || code === 403, code === 403);
  }
}

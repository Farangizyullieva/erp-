import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// TOTP (RFC 6238): 30 soniyalik qadam, 6 raqam, HMAC-SHA1 — Google Authenticator va shu kabi ilovalar bilan mos
const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(bytes: Buffer): string {
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}

function base32Decode(text: string): Buffer {
  let bits = '';
  for (const ch of text.replace(/=+$/, '').toUpperCase()) {
    const value = ALPHABET.indexOf(ch);
    if (value < 0) throw new Error('Invalid base32');
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export const generateTotpSecret = (): string => base32Encode(randomBytes(20));
export const currentStep = (now: number = Date.now()): number => Math.floor(now / 1000 / STEP_SECONDS);

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = (digest[digest.length - 1] as number) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Kodni ±1 qadam oynasida tekshiradi (soat farqi uchun). Mos kelgan qadamni qaytaradi.
 * `lastStep` dan katta bo'lmagan qadam rad etiladi — ushlab olingan kodni qayta ishlatib bo'lmaydi.
 */
export function verifyTotp(secret: string, code: string, lastStep: number | null, now: number = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const step = currentStep(now);
  for (const candidate of [step, step - 1, step + 1]) {
    if (lastStep !== null && candidate <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(totpCode(secret, candidate)), Buffer.from(code))) return candidate;
  }
  return null;
}

export const otpauthUrl = (secret: string, account: string, issuer = 'EduCRM'): string =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=${DIGITS}&period=${STEP_SECONDS}`;

/** Maxfiy kalit DB'da ochiq saqlanmaydi: AES-256-GCM, kalit — env'dagi SECRETS_ENC_KEY (TZ 11.3) */
export class SecretBox {
  private readonly key: Buffer;

  constructor(hexKey: string | undefined) {
    if (!hexKey || !/^[0-9a-f]{64}$/i.test(hexKey)) throw new Error('SECRETS_ENC_KEY must be 64 hex characters (32 bytes)');
    this.key = Buffer.from(hexKey, 'hex');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64url')).join('.');
  }

  decrypt(boxed: string): string {
    const [iv, tag, data] = boxed.split('.').map((part) => Buffer.from(part, 'base64url'));
    if (!iv || !tag || !data) throw new Error('Malformed secret');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }
}

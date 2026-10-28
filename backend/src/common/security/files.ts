import { randomUUID } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { AppError } from '../http/app-error';

// Fayl yuklash va fayl yo'llari uchun himoya (TZ 11.3): tur mijoz aytgan MIME yoki kengaytma bo'yicha emas,
// faylning haqiqiy mazmuni (magic bytes) bo'yicha aniqlanadi; saqlash nomi foydalanuvchi kiritgan nomdan olinmaydi.

const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'application/pdf', ext: 'pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  // DOCX/XLSX — ZIP konteyner
  { mime: 'application/zip', ext: 'zip', test: (b) => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05) },
];

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function sniffFileType(content: Buffer): { mime: string; ext: string } | null {
  const match = SIGNATURES.find((s) => s.test(content));
  return match ? { mime: match.mime, ext: match.ext } : null;
}

/** Hajm va haqiqiy turni tekshiradi; saqlash uchun tasodifiy nom qaytaradi (asl nom faqat metadata sifatida saqlanadi) */
export function validateUpload(content: Buffer, allowed: readonly string[], maxBytes: number = MAX_UPLOAD_BYTES): { mime: string; storageName: string } {
  if (content.length === 0) throw AppError.field('file', 'EMPTY_FILE', "Fayl bo'sh");
  if (content.length > maxBytes) throw AppError.field('file', 'FILE_TOO_LARGE', `Fayl hajmi ${Math.round(maxBytes / 1024 / 1024)} MB dan oshmasligi kerak`);
  const type = sniffFileType(content);
  if (!type || !allowed.includes(type.mime)) throw AppError.field('file', 'UNSUPPORTED_TYPE', 'Bu turdagi faylga ruxsat berilmagan');
  return { mime: type.mime, storageName: `${randomUUID()}.${type.ext}` };
}

/**
 * Path traversal himoyasi: natija har doim `root` ichida qoladi, aks holda xato.
 * `../`, absolyut yo'l, null bayt va Windows ajratgichlari rad etiladi.
 */
export function safeJoin(root: string, relative: string): string {
  if (relative.includes('\0') || relative.includes('\\')) throw AppError.forbidden("Fayl yo'li noto'g'ri");
  const base = resolve(root);
  const target = resolve(base, relative);
  if (target !== base && !target.startsWith(base + sep)) throw AppError.forbidden("Fayl yo'li noto'g'ri");
  return target;
}

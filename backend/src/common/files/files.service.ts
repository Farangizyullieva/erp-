import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Tx } from '../db/prisma.service';
import { PrismaService } from '../db/prisma.service';
import { AppError } from '../http/app-error';
import { safeJoin, validateUpload } from '../security/files';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
/** Darslik va vazifa fayllari: PDF, rasm, Word/Excel/PowerPoint (ZIP konteyner), ZIP */
const DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/zip'] as const;
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
// ZIP konteyner ichidagi Office hujjatlar: mazmun ZIP ekani tekshirilgan, aniq turi esa kengaytmadan
const OFFICE_TYPES: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
/** Asl nomdan faqat xavfsiz qism: yo'l belgilari va boshqaruv belgilari olib tashlanadi */
const cleanName = (name: string): string => name.normalize('NFC').replace(/[\\/\x00-\x1f"<>|:*?]+/g, '_').trim().slice(-120) || 'fayl';
const URL_TTL_SECONDS = 6 * 3600;

/**
 * Fayl saqlash (hozircha lokal disk; S3/MinIO'ga o'tish — shu servisning ichki o'zgarishi).
 * Himoya (TZ 11.3): tur fayl mazmunidan aniqlanadi, saqlash nomi tasodifiy, yo'l ildiz papkadan chiqmaydi,
 * o'qish esa muddatli imzolangan havola orqali — <img> uchun token kerak emas, lekin havolani taxmin qilib bo'lmaydi.
 */
@Injectable()
export class FilesService {
  private readonly root: string;
  private readonly key: string;
  private readonly baseUrl: string;

  constructor(
    config: ConfigService,
    private readonly db: PrismaService,
  ) {
    this.root = resolve(config.get<string>('UPLOAD_DIR') ?? 'uploads');
    this.key = `files:${config.getOrThrow<string>('JWT_ACCESS_SECRET')}`;
    this.baseUrl = (config.get<string>('PUBLIC_API_URL') ?? `http://localhost:${config.get('PORT') ?? 3001}/api/v1`).replace(/\/$/, '');
  }

  /** Rasmni tekshirib saqlaydi va fayl id'sini qaytaradi */
  async savePhoto(tx: Tx, tenantId: string, content: Buffer, uploadedBy: string | null): Promise<string> {
    const { mime, storageName } = validateUpload(content, IMAGE_TYPES, MAX_PHOTO_BYTES);
    const storageKey = `${tenantId}/${storageName}`;
    const path = safeJoin(this.root, storageKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, { flag: 'wx' });
    const file = await tx.storedFile.create({ data: { tenantId, storageKey, mime, size: content.length, uploadedBy } });
    return file.id;
  }

  /** Hujjatni (darslik, vazifa, javob) tekshirib saqlaydi; fayl id'sini qaytaradi */
  async saveDocument(tx: Tx, tenantId: string, content: Buffer, originalName: string, uploadedBy: string | null): Promise<string> {
    const checked = validateUpload(content, DOCUMENT_TYPES, MAX_DOCUMENT_BYTES);
    const name = cleanName(originalName);
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const mime = checked.mime === 'application/zip' && OFFICE_TYPES[ext] ? OFFICE_TYPES[ext] : checked.mime;
    const storageKey = `${tenantId}/${checked.storageName}`;
    const path = safeJoin(this.root, storageKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, { flag: 'wx' });
    const file = await tx.storedFile.create({ data: { tenantId, storageKey, mime, size: content.length, uploadedBy, name } });
    return file.id;
  }

  async remove(tx: Tx, fileId: string | null): Promise<void> {
    if (!fileId) return;
    const file = await tx.storedFile.findUnique({ where: { id: fileId } });
    if (!file) return;
    await tx.storedFile.delete({ where: { id: fileId } });
    await unlink(safeJoin(this.root, file.storageKey)).catch(() => undefined);
  }

  /** Muddatli imzolangan havola (yoki rasm yo'q bo'lsa null) */
  url(tenantId: string, fileId: string | null | undefined): string | null {
    if (!fileId) return null;
    // Muddat soat boshiga yaxlitlanadi: havola bir necha soat o'zgarmaydi va brauzer keshi ishlaydi
    const exp = Math.ceil((Date.now() / 1000 + URL_TTL_SECONDS) / 3600) * 3600;
    return `${this.baseUrl}/files/${fileId}?t=${tenantId}&exp=${exp}&sig=${this.sign(tenantId, fileId, exp)}`;
  }

  async read(fileId: string, tenantId: string, exp: number, sig: string): Promise<{ content: Buffer; mime: string; name: string | null }> {
    const expected = Buffer.from(this.sign(tenantId, fileId, exp));
    const given = Buffer.from(sig);
    if (!Number.isFinite(exp) || exp < Date.now() / 1000 || given.length !== expected.length || !timingSafeEqual(given, expected)) throw AppError.notFound('Fayl');
    const file = await this.db.tx((tx) => tx.storedFile.findUnique({ where: { id: fileId } }), tenantId);
    if (!file) throw AppError.notFound('Fayl');
    return { content: await readFile(safeJoin(this.root, file.storageKey)).catch(() => { throw AppError.notFound('Fayl'); }), mime: file.mime, name: file.name };
  }

  private sign(tenantId: string, fileId: string, exp: number): string {
    return createHmac('sha256', this.key).update(`${tenantId}:${fileId}:${exp}`).digest('base64url');
  }
}

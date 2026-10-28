import { Type } from 'class-transformer';
import { IsBooleanString, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { AppError } from '../http/app-error';
import { Page } from '../http/response.interceptor';

export class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  @IsOptional() @IsString() cursor?: string;
  /** COUNT(*) faqat so'ralganda (TZ 9.1) */
  @IsOptional() @IsBooleanString() with_total?: string;
}

interface Cursor {
  createdAt: Date;
  id: string;
}

export function decodeCursor(cursor?: string): Cursor | undefined {
  if (!cursor) return undefined;
  try {
    const [ts, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as [string, string];
    const createdAt = new Date(ts);
    if (Number.isNaN(createdAt.getTime()) || typeof id !== 'string') throw new Error('bad cursor');
    return { createdAt, id };
  } catch {
    throw AppError.field('cursor', 'INVALID_CURSOR', "Cursor noto'g'ri");
  }
}

/** (created_at DESC, id DESC) bo'yicha keyset sharti */
export function cursorWhere(cursor?: Cursor): object {
  if (!cursor) return {};
  return {
    OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }],
  };
}

/** `limit + 1` ta qator olingan bo'lishi kerak */
export function toPage<T extends { id: string; createdAt: Date }, R>(
  rows: T[],
  limit: number,
  mapRow: (row: T) => R,
  total?: number,
): Page<R> {
  const items = rows.slice(0, limit);
  const last = rows.length > limit ? items[items.length - 1] : undefined;
  const next = last ? Buffer.from(JSON.stringify([last.createdAt.toISOString(), last.id])).toString('base64url') : null;
  return new Page(items.map(mapRow), { next_cursor: next, ...(total === undefined ? {} : { total }) });
}

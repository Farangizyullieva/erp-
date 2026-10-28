/** @db.Date ustuni → 'YYYY-MM-DD' (Prisma uni UTC yarim tunidagi Date sifatida qaytaradi) */
export function toDateOnly(date: Date): string;
export function toDateOnly(date: Date | null): string | null;
export function toDateOnly(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

export const parseDateOnly = (value: string): Date => new Date(`${value.slice(0, 10)}T00:00:00Z`);

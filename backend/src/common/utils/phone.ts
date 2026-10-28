import { AppError } from '../http/app-error';

/** +998XXXXXXXXX ko'rinishiga keltiradi; noto'g'ri bo'lsa null (TZ M2.2, 11.5) */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('998') ? digits.slice(3) : digits;
  return local.length === 9 ? `+998${local}` : null;
}

export function requirePhone(input: string, field = 'phone'): string {
  const phone = normalizePhone(input);
  if (!phone) {
    throw AppError.field(field, 'INVALID_FORMAT', "Telefon raqami +998XXXXXXXXX formatida bo'lishi kerak");
  }
  return phone;
}

import { getLang, t } from './i18n';

/** +998901234567 → +998 90 123-45-67 (TZ 11.5) */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  const m = /^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return m ? `+998 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : phone;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

/** DD.MM.YYYY HH:mm */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Tiyin → "1 234 567 so'm" (TZ 11.5); so'mgacha yaxlitlash faqat ko'rsatishda */
export function formatMoney(tiyin: number): string {
  const sum = Math.round(Math.abs(tiyin) / 100);
  const text = String(sum).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${tiyin < 0 ? '−' : ''}${text} ${t("so'm")}`;
}

/** YYYY-MM-DD → DD.MM.YYYY */
export function formatDate(date: string | null | undefined): string {
  if (!date) return '—';
  const [y, m, d] = date.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

export function ageOf(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null;
  const [y, m, d] = birthDate.split('-').map(Number) as [number, number, number];
  const now = new Date();
  const hadBirthday = now.getMonth() + 1 > m || (now.getMonth() + 1 === m && now.getDate() >= d);
  return now.getFullYear() - y - (hadBirthday ? 0 : 1);
}

const WEEKDAYS = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

/** "Yakshanba, 11-oktabr" — brauzerlarda uz-UZ lokali ishonchli emas, shuning uchun nomlar qo'lda */
export function formatLongDate(date: Date): string {
  const weekday = t(WEEKDAYS[date.getDay()] ?? '');
  const month = t(MONTHS[date.getMonth()] ?? '');
  return getLang() === 'ru' ? `${weekday}, ${date.getDate()} ${month}` : `${weekday}, ${date.getDate()}-${month}`;
}

/** O'quvchi ID raqami: 42 → "#00042" */
export const studentNo = (n: number): string => `#${String(n).padStart(5, '0')}`;

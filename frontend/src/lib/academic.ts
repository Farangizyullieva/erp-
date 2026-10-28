// Guruhlar, darslar, davomat va moliya uchun umumiy tiplar va yordamchilar
export const TIME_ZONE = 'Asia/Tashkent'; // tenant vaqt zonasi (TZ 11.5); hozircha bitta tenant

export interface Ref {
  id: string;
  name: string;
}

export interface Schedule {
  days: number[];
  start_time: string;
  end_time: string;
  period_start: string;
  period_end: string;
}

export type UnitStatus = 'forming' | 'active' | 'paused' | 'finished';

export interface StudyUnit {
  id: string;
  /** Guruh raqami: qidiruvda "29" deb yozilsa shu guruh chiqadi */
  number: number;
  name: string;
  branch: Ref;
  discipline: Ref;
  level: Ref | null;
  teacher: { id: string; full_name: string };
  classroom: Ref | null;
  capacity: number;
  price_amount: number;
  status: UnitStatus;
  students_count: number;
  debtors_count: number;
  schedule: Schedule | null;
}

export interface Member {
  enrollment_id: string;
  student: { id: string; number: number; full_name: string; phone: string | null; balance: number; photo_url: string | null };
  start_date: string;
  end_date: string | null;
  active: boolean;
  price_amount: number;
  lessons_marked: number;
}

export interface Lesson {
  id: string;
  date: string;
  start_at: string;
  end_at: string;
  status: 'planned' | 'completed' | 'cancelled';
  cancel_reason: string | null;
  study_unit: { id: string; number: number; name: string; discipline: string };
  branch: Ref;
  teacher: { id: string; full_name: string };
  classroom: Ref | null;
  marked_count: number;
}

/** "29 · Backend kechki" — guruh hamma joyda raqami bilan ko'rsatiladi */
export const unitLabel = (u: { number: number; name: string }): string => `${u.number} · ${u.name}`;

export type Mark = 'present' | 'late' | 'absent_unexcused' | 'absent_excused';

export const UNIT_STATUS: Record<UnitStatus, { label: string; tone: 'info' | 'success' | 'warning' | 'neutral' }> = {
  forming: { label: 'Shakllanmoqda', tone: 'info' },
  active: { label: 'Ishlayotgan', tone: 'success' },
  paused: { label: "To'xtatilgan", tone: 'warning' },
  finished: { label: 'Tugagan', tone: 'neutral' },
};

export const WEEKDAYS = ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'];
export const WEEKDAYS_SHORT = ['Du', 'Se', 'Chor', 'Pay', 'Ju', 'Sha', 'Yak'];
export const METHODS: Record<string, string> = { cash: 'Naqd', card: 'Karta', payme: 'Payme', click: 'Click', bank: "Bank o'tkazmasi" };

// Fan nomidan barqaror rang: bir xil fan har doim bir xil rangda
const PALETTE = ['#2563eb', '#7c3aed', '#0f766e', '#c2410c', '#be185d', '#4d7c0f', '#0369a1', '#a16207'];
export const subjectColor = (name: string): string => PALETTE[[...name].reduce((hash, ch) => (hash * 16 + ch.charCodeAt(0)) % 1000003, 0) % PALETTE.length] as string;

const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** UTC vaqt → tenant zonasidagi "HH:MM" */
export const lessonTime = (iso: string): string => timeFormat.format(new Date(iso));
export const lessonHours = (iso: string): number => {
  const [h, m] = lessonTime(iso).split(':').map(Number) as [number, number];
  return h + m / 60;
};

/** Tenant zonasidagi bugungi sana, YYYY-MM-DD */
export const todayIso = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());
export const addDays = (date: string, days: number): string => new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
/** Shu sana tushgan haftaning dushanbasi */
export const mondayOf = (date: string): string => addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));

import type { AttendanceStatus, Lesson, Prisma, ScheduleRule, StudyUnit } from '@prisma/client';
import type { Tx } from '../../common/db/prisma.service';
import { AppError } from '../../common/http/app-error';
import { parseDateOnly, toDateOnly } from '../../common/utils/dates';

const DAY = 86_400_000;
export const MAX_HORIZON_DAYS = 366; // generatsiya gorizonti maksimal 12 oy (M4.3)

/** Tenant vaqt zonasidagi "devor soati"ni UTC'ga o'giradi (DB'da hamma vaqt UTC, TZ 11.5) */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  const shown = Date.UTC(parts.year as number, (parts.month as number) - 1, parts.day as number, parts.hour as number, parts.minute as number);
  return new Date(guess - (shown - guess));
}

export const todayIn = (timeZone: string, now: Date = new Date()): string => new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);

export interface Slot {
  date: string;
  startAt: Date;
  endAt: Date;
}

type RuleShape = Pick<ScheduleRule, 'daysOfWeek' | 'startTime' | 'endTime' | 'periodStart' | 'periodEnd'>;

/** Qoidadan aniq sanali darslar ro'yxati; `from` dan oldingi kunlar va bayramlar tashlab ketiladi */
export function planSlots(rule: RuleShape, timeZone: string, holidays: Set<string>, from?: string): Slot[] {
  const slots: Slot[] = [];
  const end = rule.periodEnd.getTime();
  for (let t = Math.max(rule.periodStart.getTime(), from ? parseDateOnly(from).getTime() : 0); t <= end; t += DAY) {
    const day = new Date(t);
    const date = toDateOnly(day);
    const weekday = day.getUTCDay() || 7; // 1 = Dushanba … 7 = Yakshanba
    if (!rule.daysOfWeek.includes(weekday) || holidays.has(date)) continue;
    slots.push({ date, startAt: zonedToUtc(date, rule.startTime, timeZone), endAt: zonedToUtc(date, rule.endTime, timeZone) });
  }
  return slots;
}

export interface Conflict {
  date: string;
  time: string;
  kind: 'teacher' | 'classroom';
  with: string;
}

/**
 * Tushunarli xato uchun oldindan tekshiruv: qaysi kuni, kim/qaysi xona, qaysi guruh bilan to'qnashadi.
 * Bu faqat UX — haqiqiy kafolat DB'dagi exclusion constraint (parallel so'rovlarda ham ishlaydi, M4.4).
 */
export async function findConflicts(tx: Tx, slots: Slot[], teacherId: string, classroomId: string | null, timeZone: string, ignoreUnitId?: string): Promise<Conflict[]> {
  if (!slots.length) return [];
  const busy = await tx.lesson.findMany({
    where: {
      status: { not: 'cancelled' },
      studyUnitId: ignoreUnitId ? { not: ignoreUnitId } : undefined,
      startAt: { lt: slots.reduce((max, s) => (s.endAt > max ? s.endAt : max), slots[0]!.endAt) },
      endAt: { gt: slots.reduce((min, s) => (s.startAt < min ? s.startAt : min), slots[0]!.startAt) },
      OR: [{ teacherId }, ...(classroomId ? [{ classroomId }] : [])],
    },
    select: { startAt: true, endAt: true, teacherId: true, classroomId: true, studyUnit: { select: { name: true } } },
  });
  const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const conflicts: Conflict[] = [];
  for (const slot of slots) {
    for (const lesson of busy) {
      if (lesson.startAt >= slot.endAt || lesson.endAt <= slot.startAt) continue;
      conflicts.push({ date: slot.date, time: `${time.format(lesson.startAt)}–${time.format(lesson.endAt)}`, kind: lesson.teacherId === teacherId ? 'teacher' : 'classroom', with: lesson.studyUnit.name });
    }
  }
  return conflicts;
}

export function conflictError(conflicts: Conflict[]): AppError {
  const first = conflicts[0] as Conflict;
  const [y, m, d] = first.date.split('-');
  const who = first.kind === 'teacher' ? "O'qituvchi" : 'Xona';
  const more = conflicts.length > 1 ? ` (yana ${conflicts.length - 1} ta to'qnashuv)` : '';
  return new AppError('SCHEDULE_CONFLICT', 409, `${who} band: ${d}.${m}.${y}, ${first.time} — «${first.with}» guruhi${more}`, conflicts.slice(0, 20).map((c) => ({ field: c.kind, code: 'CONFLICT', message: `${c.date} ${c.time} — ${c.with}` })));
}

/** DB exclusion constraint xatosini (23P01) tushunarli javobga aylantiradi — oldindan tekshiruvdan o'tib ketgan poyga holati uchun */
export function isOverlapViolation(e: unknown): boolean {
  const text = e instanceof Error ? `${e.message} ${JSON.stringify((e as { meta?: unknown }).meta ?? '')}` : '';
  return text.includes('23P01') || text.includes('no_overlap');
}

/**
 * Qoida bo'yicha darslarni (qayta) generatsiya qiladi (M4.3): `from` kunidan boshlab rejalashtirilgan, davomati yo'q,
 * avtomatik yaratilgan darslar almashtiriladi; o'tgan, yakunlangan yoki davomati bor darslarga tegilmaydi.
 */
export async function regenerateLessons(tx: Tx, tenantId: string, unit: Pick<StudyUnit, 'id' | 'branchId' | 'teacherId' | 'classroomId'>, rule: RuleShape, timeZone: string, from: string): Promise<number> {
  await tx.lesson.deleteMany({ where: { studyUnitId: unit.id, generated: true, status: 'planned', date: { gte: parseDateOnly(from) }, attendances: { none: {} } } });
  const holidays = await tx.holiday.findMany({ where: { skipLessons: true, date: { gte: rule.periodStart, lte: rule.periodEnd }, OR: [{ branchId: null }, { branchId: unit.branchId }] }, select: { date: true } });
  const kept = await tx.lesson.findMany({ where: { studyUnitId: unit.id, status: { not: 'cancelled' }, date: { gte: parseDateOnly(from) } }, select: { startAt: true } });
  const taken = new Set(kept.map((l) => l.startAt.getTime()));
  const slots = planSlots(rule, timeZone, new Set(holidays.map((h) => toDateOnly(h.date))), from).filter((s) => !taken.has(s.startAt.getTime()));

  const conflicts = await findConflicts(tx, slots, unit.teacherId, unit.classroomId, timeZone, unit.id);
  if (conflicts.length) throw conflictError(conflicts);
  if (slots.length) {
    await tx.lesson.createMany({
      data: slots.map((s) => ({ tenantId, studyUnitId: unit.id, date: parseDateOnly(s.date), startAt: s.startAt, endAt: s.endAt, teacherId: unit.teacherId, classroomId: unit.classroomId })),
    });
  }
  return slots.length;
}

/** BR-S3: o'quvchi holati a'zoliklardan hisoblanadi (arxivdagiga tegilmaydi) */
export async function recomputeStudentStatus(tx: Tx, studentId: string, today: string): Promise<void> {
  const student = await tx.student.findUniqueOrThrow({ where: { id: studentId }, select: { status: true } });
  if (student.status === 'archived') return;
  const enrollments = await tx.enrollment.findMany({ where: { studentId }, select: { endDate: true, studyUnit: { select: { status: true } } } });
  const open = enrollments.filter((e) => !e.endDate || toDateOnly(e.endDate) > today);
  const status = enrollments.length === 0 ? 'new' : open.some((e) => e.studyUnit.status === 'active' || e.studyUnit.status === 'forming') ? 'active' : open.length ? 'paused' : 'finished';
  if (status !== student.status) await tx.student.update({ where: { id: studentId }, data: { status } });
}

/**
 * Dars davomatini saqlaydi. Davomat pul hisobiga ta'sir QILMAYDI: to'lov — oylik abonement (finance/ledger.ts),
 * o'quvchi kelsa ham, kelmasa ham yechim o'zgarmaydi. Faqat dars kuni a'zoligi bor o'quvchilar qabul qilinadi (BR-A2).
 */
export async function saveAttendance(
  tx: Tx,
  tenantId: string,
  lesson: Pick<Lesson, 'id' | 'studyUnitId' | 'date' | 'status'>,
  entries: { studentId: string; status: AttendanceStatus }[],
  markedBy: string | null,
): Promise<void> {
  if (lesson.status === 'cancelled') throw AppError.conflict("Bekor qilingan darsga davomat qo'yib bo'lmaydi", 'LESSON_CANCELLED');
  const roster = await rosterOf(tx, lesson);
  for (const entry of entries) {
    const enrollment = roster.get(entry.studentId);
    if (!enrollment) throw AppError.field('entries', 'NOT_ENROLLED', "O'quvchi bu dars kuni guruh a'zosi emas");
    await tx.attendance.upsert({
      where: { lessonId_studentId: { lessonId: lesson.id, studentId: entry.studentId } },
      update: { status: entry.status, markedBy, markedAt: new Date() },
      create: { tenantId, lessonId: lesson.id, studentId: entry.studentId, enrollmentId: enrollment.id, status: entry.status, markedBy },
    });
  }
}

/** Dars kuni a'zoligi amal qiladigan o'quvchilar: studentId → a'zolik */
export async function rosterOf(tx: Tx, lesson: Pick<Lesson, 'studyUnitId' | 'date'>): Promise<Map<string, { id: string; priceAmount: bigint }>> {
  const where: Prisma.EnrollmentWhereInput = { studyUnitId: lesson.studyUnitId, startDate: { lte: lesson.date }, OR: [{ endDate: null }, { endDate: { gte: lesson.date } }] };
  const rows = await tx.enrollment.findMany({ where, select: { id: true, studentId: true, priceAmount: true } });
  return new Map(rows.map((r) => [r.studentId, { id: r.id, priceAmount: r.priceAmount }]));
}

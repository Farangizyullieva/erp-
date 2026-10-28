import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { FilesService } from '../../common/files/files.service';
import { assertBranchAccess, branchIdFilter } from '../../common/auth/scoping';
import { AuthContext, RequestContextStore } from '../../common/context/request-context';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { AppError } from '../../common/http/app-error';
import { parseDateOnly, toDateOnly } from '../../common/utils/dates';
import { chargeSubscriptions, reverseSubscriptionCharges } from '../finance/ledger';
import { queueAbsenceNotices } from '../messaging/notices';
import { studentScope } from '../students/students.service';
import { nextNumber } from '../../common/db/sequences';
import { AddMemberDto, AttendanceOverviewQuery, CancelLessonDto, CreateLessonDto, CreateStudyUnitDto, LessonQuery, MatrixQuery, SaveAttendanceDto, ScheduleDto, StudyUnitQuery, UpdateStudyUnitDto } from './academic.dto';
import { conflictError, findConflicts, isOverlapViolation, MAX_HORIZON_DAYS, recomputeStudentStatus, regenerateLessons, rosterOf, saveAttendance, todayIn, zonedToUtc } from './domain';

const DAY = 86_400_000;
const PAST_LIMIT_DAYS = 7; // BR-A3: bundan eski darsga davomat alohida ruxsat talab qiladi

const unitInclude = {
  branch: { select: { id: true, name: true } },
  discipline: { select: { id: true, name: true } },
  level: { select: { id: true, name: true } },
  teacher: { select: { id: true, fullName: true } },
  classroom: { select: { id: true, name: true } },
  rule: true,
} satisfies Prisma.StudyUnitInclude;
type Unit = Prisma.StudyUnitGetPayload<{ include: typeof unitInclude }>;

const lessonInclude = {
  studyUnit: { select: { id: true, number: true, name: true, branchId: true, discipline: { select: { name: true } }, branch: { select: { id: true, name: true } } } },
  teacher: { select: { id: true, fullName: true } },
  classroom: { select: { id: true, name: true } },
  _count: { select: { attendances: true } },
} satisfies Prisma.LessonInclude;
type LessonRow = Prisma.LessonGetPayload<{ include: typeof lessonInclude }>;

const unitView = (u: Unit, extra: { students: number; debtors: number }) => ({
  id: u.id,
  number: u.number,
  name: u.name,
  branch: u.branch,
  discipline: u.discipline,
  level: u.level,
  teacher: { id: u.teacher.id, full_name: u.teacher.fullName },
  classroom: u.classroom,
  capacity: u.capacity,
  price_amount: Number(u.priceAmount),
  status: u.status,
  students_count: extra.students,
  debtors_count: extra.debtors,
  schedule: u.rule && { days: u.rule.daysOfWeek, start_time: u.rule.startTime, end_time: u.rule.endTime, period_start: toDateOnly(u.rule.periodStart), period_end: toDateOnly(u.rule.periodEnd) },
});

/**
 * Guruh qidiruvi: "29" yoki "#29" — raqam bo'yicha; "29 backend" — raqam va nom/fan; "backend" — nom yoki fan bo'yicha
 */
export function unitSearch(q?: string): Prisma.StudyUnitWhereInput {
  if (!q) return {};
  const text = (value: string): Prisma.StudyUnitWhereInput => ({ OR: [{ name: { contains: value, mode: 'insensitive' } }, { discipline: { name: { contains: value, mode: 'insensitive' } } }] });
  const m = /^#?(\d{1,6})\s*(.*)$/.exec(q);
  if (!m) return text(q);
  const number = Number(m[1]);
  const rest = (m[2] as string).trim();
  // Nomida raqam bo'lgan guruhlar ("ENG-A2-01") ham yo'qolmasligi uchun nom bo'yicha moslik ham qo'shiladi
  return rest ? { OR: [{ AND: [{ number }, text(rest)] }, text(q)] } : { OR: [{ number }, text(q)] };
}

const lessonView = (l: LessonRow) => ({
  id: l.id,
  date: toDateOnly(l.date),
  start_at: l.startAt,
  end_at: l.endAt,
  status: l.status,
  cancel_reason: l.cancelReason,
  study_unit: { id: l.studyUnit.id, number: l.studyUnit.number, name: l.studyUnit.name, discipline: l.studyUnit.discipline.name },
  branch: l.studyUnit.branch,
  teacher: { id: l.teacher.id, full_name: l.teacher.fullName },
  classroom: l.classroom,
  marked_count: l._count.attendances,
});

@Injectable()
export class AcademicService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
  ) {}

  // ---------------------------------------------------------------- guruhlar

  listUnits(query: StudyUnitQuery) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const units = await tx.studyUnit.findMany({
        where: { AND: [this.unitScope(auth), { branchId: query.branch_id, status: query.status }, unitSearch(query.q)] },
        include: unitInclude,
        orderBy: [{ status: 'asc' }, { number: 'asc' }],
        take: 300,
      });
      const today = todayIn(await this.timeZone(tx));
      const counts = await this.memberCounts(tx, units.map((u) => u.id), today);
      return units.map((u) => unitView(u, counts.get(u.id) ?? { students: 0, debtors: 0 }));
    });
  }

  getUnit(id: string) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const unit = await this.findUnit(tx, auth, id);
      const today = todayIn(await this.timeZone(tx));
      const members = await tx.enrollment.findMany({
        where: { studyUnitId: id },
        orderBy: [{ endDate: { sort: 'desc', nulls: 'first' } }, { startDate: 'asc' }],
        include: { student: { select: { id: true, number: true, cachedBalance: true, photoFileId: true, client: { select: { fullName: true, phone: true } } } }, _count: { select: { attendances: true } } },
      });
      const canContacts = Boolean(auth.permissions['student.view_contacts']);
      const counts = await this.memberCounts(tx, [id], today);
      return {
        ...unitView(unit, counts.get(id) ?? { students: 0, debtors: 0 }),
        members: members.map((m) => ({
          enrollment_id: m.id,
          student: { id: m.student.id, number: m.student.number, full_name: m.student.client.fullName, phone: canContacts ? m.student.client.phone : null, balance: Number(m.student.cachedBalance), photo_url: this.files.url(auth.tenantId, m.student.photoFileId) },
          start_date: toDateOnly(m.startDate),
          end_date: toDateOnly(m.endDate),
          active: !m.endDate || toDateOnly(m.endDate) > today,
          price_amount: Number(m.priceAmount),
          lessons_marked: m._count.attendances,
        })),
      };
    });
  }

  createUnit(dto: CreateStudyUnitDto) {
    const auth = RequestContextStore.auth();
    assertBranchAccess(auth, dto.branch_id);
    if (dto.schedule) this.validateSchedule(dto.schedule);
    return this.guardOverlap(() =>
      this.db.tx(async (tx) => {
        await this.assertRefs(tx, dto.branch_id, dto);
        if (await tx.studyUnit.findFirst({ where: { name: { equals: dto.name, mode: 'insensitive' } }, select: { id: true } })) {
          throw AppError.field('name', 'DUPLICATE', 'Bunday nomli guruh allaqachon bor');
        }
        const unit = await tx.studyUnit.create({
          data: {
            tenantId: auth.tenantId,
            number: await nextNumber(tx, auth.tenantId, 'study_unit'),
            branchId: dto.branch_id,
            name: dto.name,
            disciplineId: dto.discipline_id,
            levelId: dto.level_id,
            teacherId: dto.teacher_id,
            classroomId: dto.classroom_id,
            capacity: dto.capacity,
            priceAmount: BigInt(dto.price_amount),
            // BR-U2: jadval bilan yaratilgan guruh darhol ishlaydi; jadvalsiz — "shakllanmoqda"
            status: dto.schedule ? 'active' : 'forming',
          },
        });
        let lessons = 0;
        if (dto.schedule) lessons = await this.applyRule(tx, auth.tenantId, unit, dto.schedule, toDateOnly(parseDateOnly(dto.schedule.period_start)));
        await this.audit.write(tx, auth.tenantId, { action: 'study_unit.created', entityType: 'study_unit', entityId: unit.id, newValue: { name: unit.name, lessons } });
        return { ...unitView(await this.findUnit(tx, auth, unit.id), { students: 0, debtors: 0 }), lessons_created: lessons };
      }),
    );
  }

  updateUnit(id: string, dto: UpdateStudyUnitDto) {
    const auth = RequestContextStore.auth();
    return this.guardOverlap(() =>
      this.db.tx(async (tx) => {
        const before = await this.findUnit(tx, auth, id);
        await this.assertRefs(tx, before.branchId, dto);
        if (dto.status === 'active' && !before.rule) throw AppError.conflict("Guruhni faollashtirish uchun avval jadval qo'ying", 'SCHEDULE_REQUIRED');
        if (dto.name && dto.name.toLowerCase() !== before.name.toLowerCase() && (await tx.studyUnit.findFirst({ where: { name: { equals: dto.name, mode: 'insensitive' } }, select: { id: true } }))) {
          throw AppError.field('name', 'DUPLICATE', 'Bunday nomli guruh allaqachon bor');
        }
        const unit = await tx.studyUnit.update({
          where: { id },
          data: { name: dto.name, teacherId: dto.teacher_id, classroomId: dto.classroom_id, capacity: dto.capacity, priceAmount: dto.price_amount === undefined ? undefined : BigInt(dto.price_amount), status: dto.status },
        });
        const timeZone = await this.timeZone(tx);
        const today = todayIn(timeZone);
        // O'qituvchi yoki xona o'zgarsa — kelajakdagi darslar yangisi bilan qayta generatsiya qilinadi
        if (before.rule && (unit.teacherId !== before.teacherId || unit.classroomId !== before.classroomId)) await regenerateLessons(tx, auth.tenantId, unit, before.rule, timeZone, today);
        // Guruh ishga tushsa — a'zolarning boshlangan oylari uchun abonement hisoblanadi
        if (dto.status === 'active' && before.status !== 'active') await chargeSubscriptions(tx, auth.tenantId, today, { studyUnitId: id });
        if (dto.status && dto.status !== before.status) {
          for (const e of await tx.enrollment.findMany({ where: { studyUnitId: id }, select: { studentId: true }, distinct: ['studentId'] })) await recomputeStudentStatus(tx, e.studentId, today);
        }
        await this.audit.write(tx, auth.tenantId, { action: 'study_unit.updated', entityType: 'study_unit', entityId: id, oldValue: { name: before.name, status: before.status, price_amount: Number(before.priceAmount) }, newValue: { name: unit.name, status: unit.status, price_amount: Number(unit.priceAmount) } });
        const counts = await this.memberCounts(tx, [id], today);
        return unitView(await this.findUnit(tx, auth, id), counts.get(id) ?? { students: 0, debtors: 0 });
      }),
    );
  }

  /** Jadval qoidasini qo'yadi yoki o'zgartiradi: o'tgan darslar tegilmaydi, bugundan keyingilari qayta generatsiya qilinadi */
  setSchedule(id: string, dto: ScheduleDto) {
    const auth = RequestContextStore.auth();
    this.validateSchedule(dto);
    return this.guardOverlap(() =>
      this.db.tx(async (tx) => {
        const unit = await this.findUnit(tx, auth, id);
        const today = todayIn(await this.timeZone(tx));
        const from = unit.rule ? today : dto.period_start.slice(0, 10);
        const lessons = await this.applyRule(tx, auth.tenantId, unit, dto, from);
        if (unit.status === 'forming') {
          await tx.studyUnit.update({ where: { id }, data: { status: 'active' } });
          await chargeSubscriptions(tx, auth.tenantId, today, { studyUnitId: id });
        }
        await this.audit.write(tx, auth.tenantId, { action: 'study_unit.schedule_changed', entityType: 'study_unit', entityId: id, newValue: { ...dto, lessons } });
        return { lessons_created: lessons };
      }),
    );
  }

  addMember(unitId: string, dto: AddMemberDto) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const unit = await this.findUnit(tx, auth, unitId);
      if (unit.status === 'finished') throw AppError.conflict("Tugagan guruhga o'quvchi qo'shib bo'lmaydi", 'UNIT_FINISHED');
      const student = await tx.student.findFirst({ where: { AND: [{ id: dto.student_id }, studentScope(auth, 'student.view')] }, select: { id: true, status: true } });
      if (!student) throw AppError.field('student_id', 'NOT_FOUND', "O'quvchi topilmadi");
      if (student.status === 'archived') throw AppError.field('student_id', 'ARCHIVED', "Arxivdagi o'quvchini guruhga qo'shib bo'lmaydi");
      const today = todayIn(await this.timeZone(tx));
      const startDate = parseDateOnly(dto.start_date ?? today);
      const open = await tx.enrollment.findFirst({ where: { studyUnitId: unitId, studentId: dto.student_id, OR: [{ endDate: null }, { endDate: { gte: startDate } }] }, select: { id: true } });
      if (open) throw AppError.conflict("Bu o'quvchi allaqachon shu guruh a'zosi", 'ALREADY_MEMBER');
      const enrollment = await tx.enrollment.create({ data: { tenantId: auth.tenantId, studentId: dto.student_id, studyUnitId: unitId, startDate, priceAmount: unit.priceAmount } });
      // Birinchi oylik abonement darhol hisoblanadi (o'tgan sanadan boshlangan bo'lsa — o'tgan oylar ham)
      await chargeSubscriptions(tx, auth.tenantId, today, { enrollmentId: enrollment.id });
      await recomputeStudentStatus(tx, dto.student_id, today);
      const count = (await this.memberCounts(tx, [unitId], today)).get(unitId)?.students ?? 0;
      await this.audit.write(tx, auth.tenantId, { action: 'student.enrolled', entityType: 'student', entityId: dto.student_id, newValue: { name: unit.name, start_date: toDateOnly(startDate) } });
      // BR-U3: sig'im oshsa — ogohlantirish, bloklanmaydi
      return { enrollment_id: enrollment.id, over_capacity: count > unit.capacity };
    });
  }

  /**
   * BR-E3: davomati yo'q a'zolik (xato bilan qo'shilgan) butunlay olib tashlanadi va abonement yechimi storno qilinadi.
   * Darsga qatnashgan o'quvchi chiqsa a'zolik bugungi sana bilan yopiladi — to'langan oy puli qaytarilmaydi.
   */
  removeMember(unitId: string, enrollmentId: string) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const unit = await this.findUnit(tx, auth, unitId);
      const enrollment = await tx.enrollment.findFirst({ where: { id: enrollmentId, studyUnitId: unitId }, include: { _count: { select: { attendances: true } } } });
      if (!enrollment) throw AppError.notFound("A'zolik");
      const today = todayIn(await this.timeZone(tx));
      if (enrollment._count.attendances === 0) {
        await reverseSubscriptionCharges(tx, auth.tenantId, enrollmentId, auth.userId);
        await tx.enrollment.delete({ where: { id: enrollmentId } });
      }
      else await tx.enrollment.update({ where: { id: enrollmentId }, data: { endDate: parseDateOnly(today) } });
      await recomputeStudentStatus(tx, enrollment.studentId, today);
      await this.audit.write(tx, auth.tenantId, { action: 'student.unenrolled', entityType: 'student', entityId: enrollment.studentId, newValue: { name: unit.name } });
    });
  }

  // ------------------------------------------------------------------ darslar

  listLessons(query: LessonQuery) {
    const auth = RequestContextStore.auth();
    const from = parseDateOnly(query.from);
    const to = parseDateOnly(query.to);
    if (to < from || to.getTime() - from.getTime() > 62 * DAY) throw AppError.field('to', 'INVALID_RANGE', "Davr 62 kundan oshmasligi kerak");
    return this.db.tx(async (tx) => {
      const rows = await tx.lesson.findMany({
        where: { date: { gte: from, lte: to }, teacherId: query.teacher_id, studyUnitId: query.study_unit_id, studyUnit: { AND: [this.unitScope(auth), { branchId: query.branch_id }] } },
        include: lessonInclude,
        orderBy: { startAt: 'asc' },
        take: 2000,
      });
      return rows.map(lessonView);
    });
  }

  /** Qoidadan tashqari qo'shimcha dars */
  createLesson(dto: CreateLessonDto) {
    const auth = RequestContextStore.auth();
    if (dto.end_time <= dto.start_time) throw AppError.field('end_time', 'INVALID', "Tugash vaqti boshlanishidan keyin bo'lishi kerak");
    return this.guardOverlap(() =>
      this.db.tx(async (tx) => {
        const unit = await this.findUnit(tx, auth, dto.study_unit_id);
        const timeZone = await this.timeZone(tx);
        const date = dto.date.slice(0, 10);
        const slot = { date, startAt: zonedToUtc(date, dto.start_time, timeZone), endAt: zonedToUtc(date, dto.end_time, timeZone) };
        const conflicts = await findConflicts(tx, [slot], unit.teacherId, unit.classroomId, timeZone);
        if (conflicts.length) throw conflictError(conflicts);
        const lesson = await tx.lesson.create({
          data: { tenantId: auth.tenantId, studyUnitId: unit.id, date: parseDateOnly(date), startAt: slot.startAt, endAt: slot.endAt, teacherId: unit.teacherId, classroomId: unit.classroomId, generated: false },
          include: lessonInclude,
        });
        await this.audit.write(tx, auth.tenantId, { action: 'lesson.created', entityType: 'lesson', entityId: lesson.id, newValue: { name: unit.name, date } });
        return lessonView(lesson);
      }),
    );
  }

  /** Bekor qilish (M4.5): slot bo'shaydi. Abonement oylik bo'lgani uchun pul qaytarilmaydi */
  cancelLesson(id: string, dto: CancelLessonDto) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const lesson = await this.findLesson(tx, auth, id);
      if (lesson.status === 'cancelled') return lessonView(lesson);
      await tx.attendance.deleteMany({ where: { lessonId: id } });
      const updated = await tx.lesson.update({ where: { id }, data: { status: 'cancelled', cancelReason: dto.reason, completedAt: null }, include: lessonInclude });
      await this.audit.write(tx, auth.tenantId, { action: 'lesson.cancelled', entityType: 'lesson', entityId: id, newValue: { name: lesson.studyUnit.name, date: toDateOnly(lesson.date), reason: dto.reason } });
      return lessonView(updated);
    });
  }

  // ------------------------------------------------------------------ davomat

  getAttendance(lessonId: string) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const lesson = await this.findLesson(tx, auth, lessonId);
      const roster = await rosterOf(tx, lesson);
      const [students, marks] = await Promise.all([
        tx.student.findMany({ where: { id: { in: [...roster.keys()] } }, select: { id: true, number: true, photoFileId: true, client: { select: { fullName: true } } } }),
        tx.attendance.findMany({ where: { lessonId }, select: { studentId: true, status: true } }),
      ]);
      const status = new Map(marks.map((m) => [m.studentId, m.status]));
      return {
        lesson: lessonView(lesson),
        students: students
          .map((s) => ({ id: s.id, number: s.number, full_name: s.client.fullName, photo_url: this.files.url(auth.tenantId, s.photoFileId), status: status.get(s.id) ?? null }))
          .sort((a, b) => a.full_name.localeCompare(b.full_name)),
      };
    });
  }

  saveAttendance(lessonId: string, dto: SaveAttendanceDto) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const lesson = await this.findLesson(tx, auth, lessonId);
      const timeZone = await this.timeZone(tx);
      const today = todayIn(timeZone);
      const date = toDateOnly(lesson.date);
      if (date > today) throw AppError.conflict("Hali o'tmagan darsga davomat qo'yib bo'lmaydi", 'LESSON_IN_FUTURE');
      // BR-A3: eski darsga davomat qo'yish — alohida ruxsat
      if (parseDateOnly(today).getTime() - lesson.date.getTime() > PAST_LIMIT_DAYS * DAY && !auth.permissions['attendance.mark_past']) {
        throw AppError.forbidden(`${PAST_LIMIT_DAYS} kundan eski darsga davomat qo'yish uchun alohida ruxsat kerak`);
      }
      const entries = dto.entries.map((e) => ({ studentId: e.student_id, status: e.status }));
      await saveAttendance(tx, auth.tenantId, lesson, entries, auth.userId);
      // Bugungi darsga sababsiz kelmaganlar ota-onasiga Telegram xabar (sozlamada yoqilgan bo'lsa)
      const notified = await queueAbsenceNotices(tx, auth.tenantId, lesson, entries, today, timeZone);
      if (dto.complete && lesson.status === 'planned') await tx.lesson.update({ where: { id: lessonId }, data: { status: 'completed', completedAt: new Date() } });
      await this.audit.write(tx, auth.tenantId, { action: 'attendance.marked', entityType: 'lesson', entityId: lessonId, newValue: { name: lesson.studyUnit.name, date, marked: dto.entries.length } });
      return { saved: dto.entries.length, parents_notified: notified };
    });
  }

  /** O'quvchi kartochkasidagi davomat kalendari: bir oy ichidagi darslar va holatlar */
  studentAttendance(studentId: string, month?: string) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const student = await tx.student.findFirst({ where: { AND: [{ id: studentId }, studentScope(auth, 'student.view')] }, select: { id: true } });
      if (!student) throw AppError.notFound("O'quvchi");
      const today = todayIn(await this.timeZone(tx));
      const ym = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : today.slice(0, 7);
      const from = parseDateOnly(`${ym}-01`);
      const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0));
      // A'zoligi amal qilgan darslar: belgilanmaganlari ham ko'rinadi
      const enrollments = await tx.enrollment.findMany({ where: { studentId, startDate: { lte: to }, OR: [{ endDate: null }, { endDate: { gte: from } }] }, select: { studyUnitId: true, startDate: true, endDate: true } });
      const lessons = await tx.lesson.findMany({
        where: { studyUnitId: { in: enrollments.map((e) => e.studyUnitId) }, date: { gte: from, lte: to }, studyUnit: this.unitScope(auth) },
        orderBy: { startAt: 'asc' },
        select: { id: true, date: true, startAt: true, status: true, studyUnitId: true, studyUnit: { select: { name: true } }, attendances: { where: { studentId }, select: { status: true } } },
      });
      const days = lessons
        .filter((l) => enrollments.some((e) => e.studyUnitId === l.studyUnitId && e.startDate <= l.date && (!e.endDate || e.endDate >= l.date)))
        .map((l) => ({ lesson_id: l.id, date: toDateOnly(l.date), start_at: l.startAt, group: l.studyUnit.name, cancelled: l.status === 'cancelled', status: l.attendances[0]?.status ?? null }));
      const marked = days.filter((d) => d.status && !d.cancelled);
      const attended = marked.filter((d) => d.status === 'present' || d.status === 'late').length;
      return { month: ym, today, days, summary: { lessons: days.filter((d) => !d.cancelled).length, marked: marked.length, attended, rate: marked.length ? Math.round((attended / marked.length) * 100) : null } };
    });
  }

  /** Barcha o'quvchilar davomati: davr ichida har bir o'quvchi nechta darsga kelgan, kechikkan, kelmagan */
  overview(query: AttendanceOverviewQuery) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const today = todayIn(await this.timeZone(tx));
      const to = parseDateOnly(query.to ?? today);
      const from = parseDateOnly(query.from ?? `${toDateOnly(to).slice(0, 8)}01`);
      if (to < from || to.getTime() - from.getTime() > 124 * DAY) throw AppError.field('from', 'INVALID_RANGE', 'Davr 4 oydan oshmasligi kerak');
      const units: Prisma.StudyUnitWhereInput = { AND: [this.unitScope(auth), { branchId: query.branch_id, id: query.study_unit_id }] };
      const enrollments = await tx.enrollment.findMany({
        where: {
          studyUnit: units,
          startDate: { lte: to },
          OR: [{ endDate: null }, { endDate: { gte: from } }],
          student: query.q ? { OR: [{ client: { fullName: { contains: query.q, mode: 'insensitive' } } }, ...(/^#?\d{1,9}$/.test(query.q) ? [{ number: Number(query.q.replace(/\D/g, '')) }] : [])] } : undefined,
        },
        select: { studentId: true, studyUnit: { select: { id: true, number: true, name: true } }, student: { select: { number: true, photoFileId: true, client: { select: { fullName: true } }, branch: { select: { name: true } } } } },
        take: 3000,
      });
      const rows = new Map<string, { id: string; number: number; full_name: string; branch: string; photo_url: string | null; groups: { id: string; number: number; name: string }[]; present: number; late: number; absent_excused: number; absent_unexcused: number }>();
      for (const e of enrollments) {
        const row = rows.get(e.studentId) ?? { id: e.studentId, number: e.student.number, full_name: e.student.client.fullName, branch: e.student.branch.name, photo_url: this.files.url(auth.tenantId, e.student.photoFileId), groups: [], present: 0, late: 0, absent_excused: 0, absent_unexcused: 0 };
        if (!row.groups.some((g) => g.id === e.studyUnit.id)) row.groups.push(e.studyUnit);
        rows.set(e.studentId, row);
      }
      const marks = await tx.attendance.groupBy({
        by: ['studentId', 'status'],
        where: { studentId: { in: [...rows.keys()] }, lesson: { date: { gte: from, lte: to }, status: { not: 'cancelled' }, studyUnit: units } },
        _count: true,
      });
      for (const m of marks) {
        const row = rows.get(m.studentId);
        if (row) row[m.status] += m._count;
      }
      const list = [...rows.values()].map((r) => {
        const marked = r.present + r.late + r.absent_excused + r.absent_unexcused;
        return { ...r, marked, rate: marked ? Math.round(((r.present + r.late) / marked) * 100) : null };
      });
      // Eng past davomat tepada: e'tibor kerak bo'lganlar darhol ko'rinadi; belgilanmaganlar oxirida
      list.sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101) || a.full_name.localeCompare(b.full_name));
      const total = list.reduce((s, r) => ({ marked: s.marked + r.marked, attended: s.attended + r.present + r.late, absent: s.absent + r.absent_excused + r.absent_unexcused }), { marked: 0, attended: 0, absent: 0 });
      return {
        from: toDateOnly(from),
        to: toDateOnly(to),
        summary: { students: list.length, marked: total.marked, absent: total.absent, rate: total.marked ? Math.round((total.attended / total.marked) * 100) : null, at_risk: list.filter((r) => r.rate !== null && r.rate < 70).length },
        rows: list,
      };
    });
  }

  /** Davomat kartasi (M5.3): qator = o'quvchi, ustun = dars */
  matrix(query: MatrixQuery) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const unit = await this.findUnit(tx, auth, query.study_unit_id);
      const today = todayIn(await this.timeZone(tx));
      const to = parseDateOnly(query.to ?? today);
      const from = query.from ? parseDateOnly(query.from) : new Date(to.getTime() - 30 * DAY);
      if (to.getTime() - from.getTime() > 124 * DAY) throw AppError.field('from', 'INVALID_RANGE', 'Davr 4 oydan oshmasligi kerak');
      const lessons = await tx.lesson.findMany({ where: { studyUnitId: unit.id, status: { not: 'cancelled' }, date: { gte: from, lte: to } }, orderBy: { startAt: 'asc' }, select: { id: true, date: true, status: true } });
      const enrollments = await tx.enrollment.findMany({
        where: { studyUnitId: unit.id, startDate: { lte: to }, OR: [{ endDate: null }, { endDate: { gte: from } }] },
        select: { studentId: true, startDate: true, endDate: true, student: { select: { number: true, client: { select: { fullName: true } } } } },
      });
      const marks = await tx.attendance.findMany({ where: { lessonId: { in: lessons.map((l) => l.id) } }, select: { lessonId: true, studentId: true, status: true } });
      const byKey = new Map(marks.map((m) => [`${m.lessonId}:${m.studentId}`, m.status]));
      const students = new Map<string, { id: string; number: number; full_name: string; spans: { start: Date; end: Date | null }[] }>();
      for (const e of enrollments) {
        const row = students.get(e.studentId) ?? { id: e.studentId, number: e.student.number, full_name: e.student.client.fullName, spans: [] };
        row.spans.push({ start: e.startDate, end: e.endDate });
        students.set(e.studentId, row);
      }
      return {
        study_unit: { id: unit.id, number: unit.number, name: unit.name, teacher: unit.teacher.fullName },
        from: toDateOnly(from),
        to: toDateOnly(to),
        lessons: lessons.map((l) => ({ id: l.id, date: toDateOnly(l.date), status: l.status, editable: toDateOnly(l.date) <= today })),
        rows: [...students.values()]
          .sort((a, b) => a.full_name.localeCompare(b.full_name))
          .map((s) => ({
            student: { id: s.id, number: s.number, full_name: s.full_name },
            // null = belgilanmagan; 'na' = o'sha kuni guruh a'zosi emas edi
            marks: lessons.map((l) => (s.spans.some((span) => span.start <= l.date && (!span.end || span.end >= l.date)) ? (byKey.get(`${l.id}:${s.id}`) ?? null) : 'na')),
          })),
      };
    });
  }

  // ------------------------------------------------------------- yordamchilar

  /** Filial scoping + o'qituvchi scoping (TZ 3.3): `own` — faqat o'zi dars beradigan guruhlar */
  private unitScope(auth: AuthContext): Prisma.StudyUnitWhereInput {
    return { branchId: branchIdFilter(auth), teacherId: auth.permissions['study_unit.view'] === 'own' || auth.permissions['schedule.view'] === 'own' ? auth.userId : undefined };
  }

  private async findUnit(tx: Tx, auth: AuthContext, id: string): Promise<Unit> {
    const unit = await tx.studyUnit.findFirst({ where: { AND: [{ id }, this.unitScope(auth)] }, include: unitInclude });
    if (!unit) throw AppError.notFound('Guruh');
    return unit;
  }

  private async findLesson(tx: Tx, auth: AuthContext, id: string): Promise<LessonRow> {
    const lesson = await tx.lesson.findFirst({ where: { id, studyUnit: this.unitScope(auth) }, include: lessonInclude });
    if (!lesson) throw AppError.notFound('Dars');
    return lesson;
  }

  private async timeZone(tx: Tx): Promise<string> {
    return (await tx.tenant.findUniqueOrThrow({ where: { id: RequestContextStore.auth().tenantId }, select: { timezone: true } })).timezone;
  }

  private validateSchedule(s: ScheduleDto): void {
    if (s.end_time <= s.start_time) throw AppError.field('schedule.end_time', 'INVALID', "Tugash vaqti boshlanishidan keyin bo'lishi kerak");
    const days = (parseDateOnly(s.period_end).getTime() - parseDateOnly(s.period_start).getTime()) / DAY;
    if (days < 0) throw AppError.field('schedule.period_end', 'INVALID', "Davr oxiri boshidan keyin bo'lishi kerak");
    if (days > MAX_HORIZON_DAYS) throw AppError.field('schedule.period_end', 'TOO_LONG', 'Jadval davri 12 oydan oshmasligi kerak');
  }

  private async applyRule(tx: Tx, tenantId: string, unit: { id: string; branchId: string; teacherId: string; classroomId: string | null }, s: ScheduleDto, from: string): Promise<number> {
    const data = { daysOfWeek: [...s.days].sort(), startTime: s.start_time, endTime: s.end_time, periodStart: parseDateOnly(s.period_start), periodEnd: parseDateOnly(s.period_end) };
    const rule = await tx.scheduleRule.upsert({ where: { studyUnitId: unit.id }, update: data, create: { tenantId, studyUnitId: unit.id, ...data } });
    return regenerateLessons(tx, tenantId, unit, rule, await this.timeZone(tx), from);
  }

  private async assertRefs(tx: Tx, branchId: string, dto: { discipline_id?: string; level_id?: string; teacher_id?: string; classroom_id?: string | null }): Promise<void> {
    if (!(await tx.branch.findFirst({ where: { id: branchId, isActive: true }, select: { id: true } }))) throw AppError.field('branch_id', 'NOT_FOUND', 'Filial topilmadi yoki faol emas');
    for (const [field, kind] of [['discipline_id', 'discipline'], ['level_id', 'level']] as const) {
      const id = dto[field];
      if (id && !(await tx.dictionaryItem.findFirst({ where: { id, kind }, select: { id: true } }))) throw AppError.field(field, 'NOT_FOUND', "Ma'lumotnoma yozuvi topilmadi");
    }
    if (dto.teacher_id && !(await tx.user.findFirst({ where: { id: dto.teacher_id, isActive: true }, select: { id: true } }))) throw AppError.field('teacher_id', 'NOT_FOUND', "O'qituvchi topilmadi");
    if (dto.classroom_id && !(await tx.classroom.findFirst({ where: { id: dto.classroom_id, branchId, isActive: true }, select: { id: true } }))) {
      throw AppError.field('classroom_id', 'NOT_FOUND', 'Xona shu filialda topilmadi');
    }
  }

  private async memberCounts(tx: Tx, unitIds: string[], today: string): Promise<Map<string, { students: number; debtors: number }>> {
    const rows = await tx.enrollment.findMany({
      where: { studyUnitId: { in: unitIds }, startDate: { lte: parseDateOnly(today) }, OR: [{ endDate: null }, { endDate: { gt: parseDateOnly(today) } }] },
      select: { studyUnitId: true, student: { select: { cachedBalance: true } } },
    });
    const counts = new Map<string, { students: number; debtors: number }>();
    for (const r of rows) {
      const c = counts.get(r.studyUnitId) ?? { students: 0, debtors: 0 };
      c.students++;
      if (r.student.cachedBalance < 0n) c.debtors++;
      counts.set(r.studyUnitId, c);
    }
    return counts;
  }

  /** Oldindan tekshiruvdan o'tib ketgan parallel so'rov DB constraint'ga uriladi — uni ham tushunarli xatoga aylantiradi */
  private async guardOverlap<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (isOverlapViolation(e)) throw new AppError('SCHEDULE_CONFLICT', 409, "Bu vaqtda o'qituvchi yoki xona band. Jadvalni yangilab, qayta urinib ko'ring");
      throw e;
    }
  }
}

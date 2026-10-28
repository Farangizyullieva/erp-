import { randomInt } from 'node:crypto';
import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { verify } from '@node-rs/argon2';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { Portal, RequirePermission } from '../../common/auth/decorators';
import { RequestContextStore } from '../../common/context/request-context';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { FilesService, MAX_PHOTO_BYTES } from '../../common/files/files.service';
import { documentUpload, originalName } from '../lms/lms.module';
import { AppError } from '../../common/http/app-error';
import { parseDateOnly, toDateOnly } from '../../common/utils/dates';
import { todayIn } from '../academic/domain';
import { addMonths } from '../finance/ledger';
import { hashPassword } from '../identity/auth.service';
import { studentScope } from '../students/students.service';

const DAY = 86_400_000;
// Oson parol: 6 xonali raqam — o'quvchi eslab qoladi, telefonda terish qulay.
// Taxmin qilishdan himoya: 5 ta xato urinishdan keyin kirish 15 daqiqaga bloklanadi; kabinet faqat ko'rish uchun.
const tempPassword = (): string => String(randomInt(100_000, 1_000_000));

class EnablePortalDto {
  /** Admin yozgan parol; berilmasa tizim 6 xonali raqam yaratadi */
  @IsOptional() @IsString() @MinLength(6) @MaxLength(100) password?: string;
}

class SubmitDto {
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)) @IsString() @MaxLength(4000) text?: string;
}

class ChangePasswordDto {
  @IsString() @MaxLength(200) current_password!: string;
  /** Kamida 6 belgi: o'quvchi o'zi tanlaydi (raqam ham, so'z ham bo'ladi) */
  @IsString() @MinLength(6) @MaxLength(100) new_password!: string;
}

/**
 * O'quvchi kabineti (TZ: student.enable_portal).
 *  - Xodim tomoni: kabinetni yoqish/o'chirish — o'quvchi uchun `student` rolidagi foydalanuvchi yaratiladi.
 *  - O'quvchi tomoni: `portal/*` — faqat O'ZINING ma'lumoti. O'quvchi identifikatori so'rovdan emas,
 *    tokendagi foydalanuvchidan olinadi, shuning uchun boshqa o'quvchining ma'lumotini so'rab bo'lmaydi.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
  ) {}

  // ------------------------------------------------------------ xodim tomoni

  status(studentId: string) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const student = await tx.student.findFirst({ where: { AND: [{ id: studentId }, studentScope(auth, 'student.view')] }, select: { client: { select: { phone: true } }, portalUser: { select: { phone: true, isActive: true, lastLoginAt: true } } } });
      if (!student) throw AppError.notFound("O'quvchi");
      return { enabled: Boolean(student.portalUser?.isActive), login: student.portalUser?.phone ?? student.client.phone, last_login_at: student.portalUser?.lastLoginAt ?? null };
    });
  }

  /** Kabinetni yoqadi yoki parolni yangilaydi. Parolni admin o'zi yozadi yoki tizim yaratadi; javobda bir marta qaytadi */
  async enable(studentId: string, chosen?: string) {
    const auth = RequestContextStore.auth();
    const password = chosen ?? tempPassword();
    const passwordHash = await hashPassword(password);
    return this.db.tx(async (tx) => {
      const student = await tx.student.findFirst({
        where: { AND: [{ id: studentId }, studentScope(auth, 'student.update')] },
        select: { id: true, branchId: true, status: true, portalUserId: true, client: { select: { fullName: true, phone: true } } },
      });
      if (!student) throw AppError.notFound("O'quvchi");
      if (student.status === 'archived') throw AppError.conflict("Arxivdagi o'quvchiga kabinet ochib bo'lmaydi", 'ARCHIVED');
      const phone = student.client.phone;
      if (!phone) throw AppError.conflict("Kabinetga telefon raqami bilan kiriladi. Avval o'quvchining telefon raqamini kiriting", 'PHONE_REQUIRED');

      if (student.portalUserId) {
        await tx.user.update({ where: { id: student.portalUserId }, data: { passwordHash, phone, fullName: student.client.fullName, isActive: true, failedLoginCount: 0, lockedUntil: null } });
        // Eski parol bilan ochilgan sessiyalar yopiladi
        await tx.refreshToken.updateMany({ where: { userId: student.portalUserId, revokedAt: null }, data: { revokedAt: new Date() } });
      } else {
        if (await tx.user.findFirst({ where: { phone }, select: { id: true } })) throw AppError.conflict('Bu telefon raqami bilan boshqa foydalanuvchi (xodim yoki o\'quvchi) bor', 'PHONE_TAKEN');
        const role = await tx.role.findFirst({ where: { code: 'student' }, select: { id: true } });
        if (!role) throw AppError.conflict("«O'quvchi» roli topilmadi", 'ROLE_MISSING');
        const user = await tx.user.create({
          data: { tenantId: auth.tenantId, phone, fullName: student.client.fullName, passwordHash, roles: { create: { tenantId: auth.tenantId, roleId: role.id } }, branches: { create: { tenantId: auth.tenantId, branchId: student.branchId } } },
        });
        await tx.student.update({ where: { id: student.id }, data: { portalUserId: user.id } });
      }
      await this.audit.write(tx, auth.tenantId, { action: 'student.portal_enabled', entityType: 'student', entityId: student.id, newValue: { full_name: student.client.fullName } });
      return { login: phone, password };
    });
  }

  disable(studentId: string) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const student = await tx.student.findFirst({ where: { AND: [{ id: studentId }, studentScope(auth, 'student.update')] }, select: { id: true, portalUserId: true, client: { select: { fullName: true } } } });
      if (!student) throw AppError.notFound("O'quvchi");
      if (!student.portalUserId) return;
      await tx.user.update({ where: { id: student.portalUserId }, data: { isActive: false } });
      await tx.refreshToken.updateMany({ where: { userId: student.portalUserId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.write(tx, auth.tenantId, { action: 'student.portal_disabled', entityType: 'student', entityId: student.id, newValue: { full_name: student.client.fullName } });
    });
  }

  // ---------------------------------------------------------- o'quvchi tomoni

  /** Tokendagi foydalanuvchiga bog'langan o'quvchi; bog'lanmagan bo'lsa (masalan xodim) — 403 */
  private async self(tx: Tx): Promise<{ id: string; timeZone: string; tenantName: string }> {
    const auth = RequestContextStore.auth();
    const student = await tx.student.findFirst({ where: { portalUserId: auth.userId, status: { not: 'archived' } }, select: { id: true } });
    if (!student) throw AppError.forbidden("Bu bo'lim faqat o'quvchi kabineti uchun");
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { timezone: true, name: true } });
    return { id: student.id, timeZone: tenant.timezone, tenantName: tenant.name };
  }

  /** O'quvchining a'zoligi amal qilgan darslar */
  private async lessonsOf(tx: Tx, studentId: string, from: Date, to: Date) {
    const enrollments = await tx.enrollment.findMany({ where: { studentId, startDate: { lte: to }, OR: [{ endDate: null }, { endDate: { gte: from } }] }, select: { studyUnitId: true, startDate: true, endDate: true } });
    const lessons = await tx.lesson.findMany({
      where: { studyUnitId: { in: enrollments.map((e) => e.studyUnitId) }, date: { gte: from, lte: to } },
      orderBy: { startAt: 'asc' },
      select: {
        id: true, date: true, startAt: true, endAt: true, status: true, studyUnitId: true,
        studyUnit: { select: { number: true, name: true, discipline: { select: { name: true } } } },
        teacher: { select: { fullName: true } },
        classroom: { select: { name: true } },
        attendances: { where: { studentId }, select: { status: true } },
      },
    });
    return lessons
      .filter((l) => enrollments.some((e) => e.studyUnitId === l.studyUnitId && e.startDate <= l.date && (!e.endDate || e.endDate >= l.date)))
      .map((l) => ({
        id: l.id,
        date: toDateOnly(l.date),
        start_at: l.startAt,
        end_at: l.endAt,
        cancelled: l.status === 'cancelled',
        group: `${l.studyUnit.number} · ${l.studyUnit.name}`,
        discipline: l.studyUnit.discipline.name,
        teacher: l.teacher.fullName,
        classroom: l.classroom?.name ?? null,
        mark: l.attendances[0]?.status ?? null,
      }));
  }

  me() {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const self = await this.self(tx);
      const today = todayIn(self.timeZone);
      const todayDate = parseDateOnly(today);
      const s = await tx.student.findUniqueOrThrow({
        where: { id: self.id },
        select: {
          number: true, status: true, cachedBalance: true, photoFileId: true,
          client: { select: { fullName: true, phone: true } },
          branch: { select: { name: true, address: true, phone: true } },
          enrollments: {
            where: { OR: [{ endDate: null }, { endDate: { gt: todayDate } }] },
            select: { startDate: true, priceAmount: true, studyUnit: { select: { id: true, number: true, name: true, status: true, discipline: { select: { name: true } }, level: { select: { name: true } }, teacher: { select: { fullName: true } }, classroom: { select: { name: true } }, rule: { select: { daysOfWeek: true, startTime: true, endTime: true } } } } },
          },
        },
      });
      const monthStart = parseDateOnly(`${today.slice(0, 8)}01`);
      const month = await this.lessonsOf(tx, self.id, monthStart, todayDate);
      const marked = month.filter((l) => l.mark && !l.cancelled);
      const attended = marked.filter((l) => l.mark === 'present' || l.mark === 'late').length;
      const upcoming = (await this.lessonsOf(tx, self.id, todayDate, new Date(todayDate.getTime() + 7 * DAY))).filter((l) => !l.cancelled && new Date(l.end_at) > new Date()).slice(0, 6);
      const groups = s.enrollments.map((e) => {
        let k = 1;
        while (addMonths(e.startDate, k) <= todayDate && k < 240) k++;
        return {
          id: e.studyUnit.id,
          number: e.studyUnit.number,
          name: e.studyUnit.name,
          course: [e.studyUnit.discipline.name, e.studyUnit.level?.name].filter(Boolean).join(' · '),
          teacher: e.studyUnit.teacher.fullName,
          classroom: e.studyUnit.classroom?.name ?? null,
          schedule: e.studyUnit.rule && { days: e.studyUnit.rule.daysOfWeek, start_time: e.studyUnit.rule.startTime, end_time: e.studyUnit.rule.endTime },
          price_amount: Number(e.priceAmount),
          next_payment_date: e.studyUnit.status === 'active' ? toDateOnly(addMonths(e.startDate, k)) : null,
        };
      });
      return {
        center: self.tenantName,
        today,
        student: { number: s.number, full_name: s.client.fullName, phone: s.client.phone, status: s.status, photo_url: this.files.url(auth.tenantId, s.photoFileId), branch: s.branch },
        balance: Number(s.cachedBalance),
        monthly_price: groups.reduce((sum, g) => sum + g.price_amount, 0),
        next_payment_date: groups.flatMap((g) => (g.next_payment_date ? [g.next_payment_date] : [])).sort()[0] ?? null,
        attendance: { marked: marked.length, attended, rate: marked.length ? Math.round((attended / marked.length) * 100) : null },
        groups,
        upcoming,
      };
    });
  }

  /** O'quvchi parolini o'zi almashtiradi: eski parol talab qilinadi, boshqa qurilmalardagi sessiyalar yopiladi */
  async changePassword(dto: ChangePasswordDto) {
    const auth = RequestContextStore.auth();
    const user = await this.db.tx(async (tx) => {
      await this.self(tx);
      return tx.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { passwordHash: true } });
    });
    if (!(await verify(user.passwordHash, dto.current_password))) throw AppError.field('current_password', 'INVALID_PASSWORD', "Joriy parol noto'g'ri");
    if (dto.new_password === dto.current_password) throw AppError.field('new_password', 'SAME_PASSWORD', "Yangi parol eskisidan farq qilishi kerak");
    const passwordHash = await hashPassword(dto.new_password);
    await this.db.tx(async (tx) => {
      await tx.user.update({ where: { id: auth.userId }, data: { passwordHash } });
      await tx.refreshToken.updateMany({ where: { userId: auth.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.write(tx, auth.tenantId, { action: 'student.portal_password_changed', entityType: 'user', entityId: auth.userId });
    });
  }

  // --------------------------------------------- darsliklar va vazifalar

  private fileView(tenantId: string, file: { id: string; name: string | null; mime: string; size: number } | null) {
    return file ? { url: this.files.url(tenantId, file.id), name: file.name, mime: file.mime, size: file.size } : null;
  }

  /** O'quvchi hozir a'zo bo'lgan guruhlar (faqat shularning materiallari va vazifalari ko'rinadi) */
  private async myUnitIds(tx: Tx, studentId: string, today: string): Promise<string[]> {
    const rows = await tx.enrollment.findMany({ where: { studentId, startDate: { lte: parseDateOnly(today) }, OR: [{ endDate: null }, { endDate: { gt: parseDateOnly(today) } }] }, select: { studyUnitId: true } });
    return [...new Set(rows.map((r) => r.studyUnitId))];
  }

  private assignmentView(tenantId: string, today: string, a: Prisma.AssignmentGetPayload<{ include: { file: true; studyUnit: { select: { id: true; number: true; name: true } }; submissions: { include: { file: true } } } }>) {
    const mine = a.submissions[0] ?? null;
    const due = toDateOnly(a.dueDate);
    return {
      id: a.id,
      title: a.title,
      description: a.description,
      due_date: due,
      max_score: a.maxScore,
      file: this.fileView(tenantId, a.file),
      group: { id: a.studyUnit.id, number: a.studyUnit.number, name: a.studyUnit.name },
      created_at: a.createdAt,
      // new — hali topshirilmagan; overdue — muddati o'tgan; submitted — tekshirilmoqda; graded — baholangan
      status: mine?.score != null ? 'graded' : mine ? 'submitted' : due && due < today ? 'overdue' : 'new',
      submission: mine && { text: mine.text, file: this.fileView(tenantId, mine.file), submitted_at: mine.submittedAt, score: mine.score, feedback: mine.feedback },
    };
  }

  assignments(groupId?: string) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const self = await this.self(tx);
      const today = todayIn(self.timeZone);
      const units = await this.myUnitIds(tx, self.id, today);
      const rows = await tx.assignment.findMany({
        where: { studyUnitId: groupId ? { in: units.includes(groupId) ? [groupId] : [] } : { in: units } },
        orderBy: { createdAt: 'desc' },
        include: { file: true, studyUnit: { select: { id: true, number: true, name: true } }, submissions: { where: { studentId: self.id }, include: { file: true } } },
      });
      return rows.map((a) => this.assignmentView(auth.tenantId, today, a));
    });
  }

  materials(groupId?: string) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const self = await this.self(tx);
      const units = await this.myUnitIds(tx, self.id, todayIn(self.timeZone));
      const rows = await tx.material.findMany({
        where: { studyUnitId: groupId ? { in: units.includes(groupId) ? [groupId] : [] } : { in: units } },
        orderBy: { createdAt: 'desc' },
        include: { file: true, studyUnit: { select: { id: true, number: true, name: true } } },
      });
      return rows.map((m) => ({ id: m.id, title: m.title, description: m.description, link: m.link, file: this.fileView(auth.tenantId, m.file), group: { id: m.studyUnit.id, number: m.studyUnit.number, name: m.studyUnit.name }, created_at: m.createdAt }));
    });
  }

  /** Javob topshirish yoki qayta topshirish (baholangunga qadar). Muddat o'tgan bo'lsa ham qabul qilinadi — o'qituvchi ko'radi */
  submit(assignmentId: string, dto: SubmitDto, file?: Express.Multer.File) {
    const auth = RequestContextStore.auth();
    if (!dto.text && !file?.buffer?.length) throw AppError.field('file', 'REQUIRED', 'Fayl yuklang yoki javob matnini yozing');
    return this.db.tx(async (tx) => {
      const self = await this.self(tx);
      const units = await this.myUnitIds(tx, self.id, todayIn(self.timeZone));
      const assignment = await tx.assignment.findFirst({ where: { id: assignmentId, studyUnitId: { in: units } }, select: { id: true, title: true } });
      if (!assignment) throw AppError.notFound('Vazifa');
      const existing = await tx.submission.findUnique({ where: { assignmentId_studentId: { assignmentId, studentId: self.id } } });
      if (existing?.score != null) throw AppError.conflict("Vazifa baholangan — javobni o'zgartirib bo'lmaydi", 'ALREADY_GRADED');
      const fileId = file?.buffer?.length ? await this.files.saveDocument(tx, auth.tenantId, file.buffer, originalName(file), auth.userId) : (existing?.fileId ?? null);
      await tx.submission.upsert({
        where: { assignmentId_studentId: { assignmentId, studentId: self.id } },
        update: { text: dto.text ?? existing?.text ?? null, fileId, submittedAt: new Date() },
        create: { tenantId: auth.tenantId, assignmentId, studentId: self.id, text: dto.text, fileId },
      });
      // Yangi fayl yuklansa eskisi o'chiriladi
      if (existing?.fileId && existing.fileId !== fileId) await this.files.remove(tx, existing.fileId);
      await this.audit.write(tx, auth.tenantId, { action: 'submission.submitted', entityType: 'student', entityId: self.id, newValue: { title: assignment.title } });
    });
  }

  // ------------------------------------------ ko'rsatkichlar va reyting

  /** Oxirgi 6 oy davomati va vazifa natijalari */
  stats() {
    return this.db.tx(async (tx) => {
      const self = await this.self(tx);
      const today = todayIn(self.timeZone);
      const start = parseDateOnly(`${today.slice(0, 7)}-01`);
      start.setUTCMonth(start.getUTCMonth() - 5);
      const lessons = await this.lessonsOf(tx, self.id, start, parseDateOnly(today));
      const months = Array.from({ length: 6 }, (_, i) => {
        const d = new Date(start);
        d.setUTCMonth(d.getUTCMonth() + i);
        const ym = d.toISOString().slice(0, 7);
        const marked = lessons.filter((l) => l.date.startsWith(ym) && l.mark && !l.cancelled);
        const attended = marked.filter((l) => l.mark === 'present' || l.mark === 'late').length;
        return { month: ym, lessons: marked.length, attended, late: marked.filter((l) => l.mark === 'late').length, rate: marked.length ? Math.round((attended / marked.length) * 100) : null };
      });
      const units = await this.myUnitIds(tx, self.id, today);
      const assignments = await tx.assignment.findMany({ where: { studyUnitId: { in: units } }, select: { maxScore: true, dueDate: true, submissions: { where: { studentId: self.id }, select: { score: true } } } });
      const graded = assignments.filter((a) => a.submissions[0]?.score != null);
      const all = lessons.filter((l) => l.mark && !l.cancelled);
      return {
        months,
        attendance: { lessons: all.length, attended: all.filter((l) => l.mark === 'present' || l.mark === 'late').length, late: all.filter((l) => l.mark === 'late').length, absent: all.filter((l) => l.mark === 'absent_excused' || l.mark === 'absent_unexcused').length },
        homework: {
          total: assignments.length,
          submitted: assignments.filter((a) => a.submissions.length).length,
          graded: graded.length,
          missed: assignments.filter((a) => !a.submissions.length && a.dueDate && toDateOnly(a.dueDate) < today).length,
          // Har bir baho maksimal ballga nisbatan foizda
          average: graded.length ? Math.round(graded.reduce((sum, a) => sum + ((a.submissions[0]?.score ?? 0) / a.maxScore) * 100, 0) / graded.length) : null,
        },
      };
    });
  }

  /**
   * Guruh reytingi: ball = vazifa baholari (foizda, har biri 100 gacha) + kelgan har bir dars uchun 10 ball.
   * Faqat o'quvchining o'z guruhlari; guruhdoshlarning ismi va balli ko'rinadi, boshqa ma'lumoti emas.
   */
  rating() {
    return this.db.tx(async (tx) => {
      const self = await this.self(tx);
      const today = todayIn(self.timeZone);
      const units = await tx.studyUnit.findMany({ where: { id: { in: await this.myUnitIds(tx, self.id, today) } }, select: { id: true, number: true, name: true } });
      const result = [];
      for (const unit of units) {
        const members = await tx.enrollment.findMany({ where: { studyUnitId: unit.id, OR: [{ endDate: null }, { endDate: { gt: parseDateOnly(today) } }] }, select: { studentId: true, student: { select: { client: { select: { fullName: true } } } } } });
        const ids = members.map((m) => m.studentId);
        const attended = await tx.attendance.groupBy({ by: ['studentId'], where: { studentId: { in: ids }, status: { in: ['present', 'late'] }, lesson: { studyUnitId: unit.id } }, _count: true });
        const scores = await tx.submission.findMany({ where: { studentId: { in: ids }, score: { not: null }, assignment: { studyUnitId: unit.id } }, select: { studentId: true, score: true, assignment: { select: { maxScore: true } } } });
        const points = new Map<string, number>();
        for (const a of attended) points.set(a.studentId, (points.get(a.studentId) ?? 0) + a._count * 10);
        for (const s of scores) points.set(s.studentId, (points.get(s.studentId) ?? 0) + Math.round(((s.score ?? 0) / s.assignment.maxScore) * 100));
        const rows = members
          .map((m) => ({ student_id: m.studentId, name: m.student.client.fullName, points: points.get(m.studentId) ?? 0 }))
          .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
          .map((r, i) => ({ place: i + 1, name: r.name, points: r.points, me: r.student_id === self.id }));
        result.push({ group: unit, rows });
      }
      return result;
    });
  }

  /** O'quvchi profil rasmini o'zi qo'yadi */
  setPhoto(file?: Express.Multer.File) {
    const auth = RequestContextStore.auth();
    if (!file?.buffer?.length) throw AppError.field('file', 'REQUIRED', 'Rasm fayli yuborilmadi');
    return this.db.tx(async (tx) => {
      const self = await this.self(tx);
      const student = await tx.student.findUniqueOrThrow({ where: { id: self.id }, select: { photoFileId: true } });
      const fileId = await this.files.savePhoto(tx, auth.tenantId, file.buffer, auth.userId);
      await tx.student.update({ where: { id: self.id }, data: { photoFileId: fileId } });
      await this.files.remove(tx, student.photoFileId);
      return { photo_url: this.files.url(auth.tenantId, fileId) };
    });
  }

  /** Oylik ko'rinish: jadval va davomat bitta ro'yxatda */
  lessons(month?: string) {
    return this.db.tx(async (tx) => {
      const self = await this.self(tx);
      const today = todayIn(self.timeZone);
      const ym = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : today.slice(0, 7);
      const from = parseDateOnly(`${ym}-01`);
      const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0));
      return { month: ym, today, lessons: await this.lessonsOf(tx, self.id, from, to) };
    });
  }

  payments() {
    return this.db.tx(async (tx) => {
      const self = await this.self(tx);
      const rows = await tx.ledgerEntry.findMany({ where: { studentId: self.id }, orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }], take: 200 });
      const cancelled = new Set(rows.flatMap((r) => (r.reversesEntryId ? [r.reversesEntryId] : [])));
      const balance = (await tx.student.findUniqueOrThrow({ where: { id: self.id }, select: { cachedBalance: true } })).cachedBalance;
      return {
        balance: Number(balance),
        // Bekor qilingan to'lov va uning teskari yozuvi o'quvchiga ko'rsatilmaydi — ular bir-birini yopadi
        entries: rows
          .filter((r) => !cancelled.has(r.id) && !(r.reversesEntryId && r.entryType === 'payment'))
          .map((r) => ({ id: r.id, type: r.reversesEntryId ? 'reversal' : r.sourceType === 'subscription' ? 'subscription' : r.entryType, amount: Number(r.amount), occurred_at: r.occurredAt, method: r.method, comment: r.sourceType === 'subscription' ? r.comment : null })),
      };
    });
  }
}

@Controller()
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @RequirePermission('student.enable_portal')
  @Get('students/:id/portal')
  status(@Param('id', ParseUUIDPipe) id: string) {
    return this.portal.status(id);
  }

  @RequirePermission('student.enable_portal')
  @Post('students/:id/portal')
  @HttpCode(200)
  enable(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EnablePortalDto) {
    return this.portal.enable(id, dto.password);
  }

  @RequirePermission('student.enable_portal')
  @Delete('students/:id/portal')
  @HttpCode(204)
  disable(@Param('id', ParseUUIDPipe) id: string) {
    return this.portal.disable(id);
  }

  @Portal()
  @Get('portal/me')
  me() {
    return this.portal.me();
  }

  @Portal()
  @Get('portal/lessons')
  lessons(@Query('month') month?: string) {
    return this.portal.lessons(month);
  }

  @Portal()
  @Get('portal/assignments')
  assignments(@Query('group') group?: string) {
    return this.portal.assignments(group && /^[0-9a-f-]{36}$/.test(group) ? group : undefined);
  }

  @Portal()
  @Post('portal/assignments/:id/submission')
  @HttpCode(204)
  @UseInterceptors(documentUpload())
  submit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitDto, @UploadedFile() file?: Express.Multer.File) {
    return this.portal.submit(id, dto, file);
  }

  @Portal()
  @Get('portal/materials')
  materials(@Query('group') group?: string) {
    return this.portal.materials(group && /^[0-9a-f-]{36}$/.test(group) ? group : undefined);
  }

  @Portal()
  @Get('portal/stats')
  stats() {
    return this.portal.stats();
  }

  @Portal()
  @Get('portal/rating')
  rating() {
    return this.portal.rating();
  }

  @Portal()
  @Post('portal/photo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } }))
  photo(@UploadedFile() file?: Express.Multer.File) {
    return this.portal.setPhoto(file);
  }

  @Portal()
  @Post('portal/password')
  @HttpCode(204)
  changePassword(@Body() dto: ChangePasswordDto) {
    return this.portal.changePassword(dto);
  }

  @Portal()
  @Get('portal/payments')
  payments() {
    return this.portal.payments();
  }
}

@Module({ controllers: [PortalController], providers: [PortalService] })
export class PortalModule {}

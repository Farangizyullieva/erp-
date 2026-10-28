import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { FilesService } from '../../common/files/files.service';
import { Notifier } from '../../common/notifications/notifier.service';
import type { PermissionCode } from '../../common/auth/permissions.catalog';
import { assertBranchAccess, branchIdFilter } from '../../common/auth/scoping';
import { AuthContext, RequestContextStore } from '../../common/context/request-context';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { nextNumber } from '../../common/db/sequences';
import { AppError } from '../../common/http/app-error';
import { parseDateOnly, toDateOnly } from '../../common/utils/dates';
import { cursorWhere, decodeCursor, toPage } from '../../common/utils/pagination';
import { requirePhone } from '../../common/utils/phone';
import { ContactPersonDto, CreateStudentDto, StudentQuery, UpdateContactPersonDto, UpdateStudentDto } from './students.dto';

// Ochiq a'zoliklar (guruhdan chiqmagan): ro'yxat va kartochkada "qaysi guruhda, qaysi kursda" ko'rsatish uchun
const openEnrollments = {
  where: { endDate: null },
  orderBy: { startDate: 'asc' },
  select: {
    id: true,
    startDate: true,
    studyUnit: { select: { id: true, number: true, name: true, status: true, discipline: { select: { name: true } }, level: { select: { name: true } }, teacher: { select: { fullName: true } } } },
  },
} satisfies Prisma.Student$enrollmentsArgs;

const listInclude = {
  client: true,
  enrollments: openEnrollments,
  branch: { select: { id: true, name: true } },
  owner: { select: { id: true, fullName: true } },
} satisfies Prisma.StudentInclude;

const detailInclude = {
  ...listInclude,
  client: { include: { contactPersons: { orderBy: { createdAt: 'asc' }, include: { messengerLinks: { where: { blockedAt: null }, select: { id: true } } } } } },
  adSource: { select: { id: true, name: true } },
  learningGoal: { select: { id: true, name: true } },
} satisfies Prisma.StudentInclude;

type StudentRow = Prisma.StudentGetPayload<{ include: typeof listInclude }>;
type StudentDetail = Prisma.StudentGetPayload<{ include: typeof detailInclude }>;
type Contact = StudentDetail['client']['contactPersons'][number];

const canSeeContacts = (auth: AuthContext): boolean => Boolean(auth.permissions['student.view_contacts']);

const rowView = (s: StudentRow, withContacts: boolean) => ({
  id: s.id,
  number: s.number,
  full_name: s.client.fullName,
  birth_date: toDateOnly(s.client.birthDate),
  gender: s.client.gender,
  phone: withContacts ? s.client.phone : null,
  branch: s.branch,
  status: s.status,
  // Tiyinda (TZ 9.1); bigint JSON'ga sig'ishi uchun number — 9·10^15 tiyingacha xavfsiz
  balance: Number(s.cachedBalance),
  owner: s.owner && { id: s.owner.id, full_name: s.owner.fullName },
  blacklisted: s.blacklisted,
  created_at: s.createdAt,
  // Hozir o'qiyotgan guruhlari: guruh, kurs (fan + daraja), o'qituvchi
  groups: s.enrollments.map((e) => ({
    id: e.studyUnit.id,
    number: e.studyUnit.number,
    name: e.studyUnit.name,
    course: [e.studyUnit.discipline.name, e.studyUnit.level?.name].filter(Boolean).join(' · '),
    teacher: e.studyUnit.teacher.fullName,
    status: e.studyUnit.status,
    since: toDateOnly(e.startDate),
  })),
});

const contactView = (c: Omit<Contact, 'messengerLinks'> & { messengerLinks?: { id: string }[] }) => ({
  id: c.id,
  full_name: c.fullName,
  relation: c.relation,
  phone: c.phone,
  email: c.email,
  is_bill_recipient: c.isBillRecipient,
  receives_notifications: c.receivesNotifications,
  telegram_linked: (c.messengerLinks?.length ?? 0) > 0,
});

const detailView = (s: StudentDetail, withContacts: boolean) => ({
  ...rowView(s, withContacts),
  email: withContacts ? s.client.email : null,
  contacts_hidden: !withContacts,
  contacts: withContacts ? s.client.contactPersons.map(contactView) : [],
  ad_source: s.adSource,
  learning_goal: s.learningGoal,
  notification_language: s.notificationLanguage,
  note: s.note,
  blacklist_reason: s.blacklistReason,
  archived_at: s.archivedAt,
});

/** Branch scoping + ownership scoping (TZ 3.3); birlashtirilgan dublikatlar ko'rinmaydi. Boshqa modullar ham shu orqali cheklaydi */
export function studentScope(auth: AuthContext, permission: PermissionCode): Prisma.StudentWhereInput {
  return {
    mergedIntoId: null,
    branchId: branchIdFilter(auth),
    ownerId: auth.permissions[permission] === 'own' ? auth.userId : undefined,
  };
}

@Injectable()
export class StudentsService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
    private readonly notifier: Notifier,
    private readonly files: FilesService,
  ) {}

  list(query: StudentQuery) {
    const auth = RequestContextStore.auth();
    const withContacts = canSeeContacts(auth);
    const limit = query.limit ?? 50;
    const f = query.filter ?? {};
    const and: Prisma.StudentWhereInput[] = [this.scope(auth, 'student.view')];
    // Arxivdagilar faqat aniq so'ralganda ko'rinadi
    and.push(f.status?.length ? { status: { in: f.status } } : { status: { not: 'archived' } });
    if (f.branch_id) and.push({ branchId: f.branch_id });
    if (f.owner_id) and.push({ ownerId: f.owner_id });
    if (f.blacklisted) and.push({ blacklisted: f.blacklisted === 'true' });
    if (f.study_unit_id) and.push({ enrollments: { some: { studyUnitId: f.study_unit_id, endDate: null } } });
    if (f.discipline_id) and.push({ enrollments: { some: { endDate: null, studyUnit: { disciplineId: f.discipline_id } } } });
    if (query.q) {
      const digits = query.q.replace(/\D/g, '');
      const or: Prisma.StudentWhereInput[] = [{ client: { fullName: { contains: query.q, mode: 'insensitive' } } }];
      // "#42", "00042" yoki "42" — o'quvchi ID raqami bo'yicha aniq qidiruv
      if (/^#?\d{1,9}$/.test(query.q)) or.push({ number: Number(digits) });
      // Kontaktni ko'ra olmaydigan foydalanuvchi telefon bo'yicha qidirib ham topa olmasligi kerak
      if (withContacts && digits.length >= 3) {
        or.push({ client: { phone: { contains: digits } } });
        or.push({ client: { contactPersons: { some: { phone: { contains: digits } } } } });
      }
      and.push({ OR: or });
    }

    return this.db.tx(async (tx) => {
      const rows = await tx.student.findMany({
        where: { AND: [...and, cursorWhere(decodeCursor(query.cursor))] },
        include: listInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      const total = query.with_total === 'true' ? await tx.student.count({ where: { AND: and } }) : undefined;
      return toPage(rows, limit, (s) => ({ ...rowView(s, withContacts), photo_url: this.files.url(s.tenantId, s.photoFileId) }), total);
    });
  }

  get(id: string) {
    const auth = RequestContextStore.auth();
    const withContacts = canSeeContacts(auth);
    return this.db.tx(async (tx) => {
      const student = await this.find(tx, auth, id, 'student.view');
      // Kontaktlarni ko'rish — access log (M11.3)
      if (withContacts) {
        await this.audit.write(tx, auth.tenantId, { action: 'student.contacts_viewed', entityType: 'student', entityId: id });
      }
      return this.detail(student, withContacts);
    });
  }

  create(dto: CreateStudentDto) {
    const auth = RequestContextStore.auth();
    assertBranchAccess(auth, dto.branch_id);
    const phone = dto.phone ? requirePhone(dto.phone) : null;
    const contactPhone = dto.contact?.phone ? requirePhone(dto.contact.phone, 'contact.phone') : null;

    return this.db.tx(async (tx) => {
      await this.assertRefs(tx, dto);
      if (phone && !dto.confirm_duplicate) {
        // Dublikat taqiqlanmaydi (aka-ukalar bitta raqamda bo'lishi mumkin), lekin ogohlantiriladi (M2.2)
        const same = await tx.client.findMany({ where: { phone }, select: { fullName: true }, take: 5 });
        if (same.length) {
          throw new AppError('POSSIBLE_DUPLICATE', 409, 'Bu telefon raqami bilan mijoz allaqachon bor', [
            { field: 'phone', code: 'DUPLICATE', message: same.map((c) => c.fullName).join(', ') },
          ]);
        }
      }
      const student = await tx.student.create({
        data: {
          tenantId: auth.tenantId,
          number: await nextNumber(tx, auth.tenantId, 'student'),
          branch: { connect: { id: dto.branch_id } },
          owner: connect(dto.owner_id),
          adSource: connect(dto.ad_source_id),
          learningGoal: connect(dto.learning_goal_id),
          note: dto.note ?? null,
          client: {
            create: {
              tenantId: auth.tenantId,
              fullName: dto.full_name,
              phone,
              email: dto.email?.toLowerCase() ?? null,
              birthDate: dto.birth_date ? parseDateOnly(dto.birth_date) : null,
              gender: dto.gender ?? null,
              contactPersons: dto.contact
                ? {
                    create: {
                      tenantId: auth.tenantId,
                      fullName: dto.contact.full_name,
                      relation: dto.contact.relation,
                      phone: contactPhone,
                      email: dto.contact.email?.toLowerCase() ?? null,
                      // Birinchi aloqa shaxsi default schyot oluvchi
                      isBillRecipient: dto.contact.is_bill_recipient ?? true,
                      receivesNotifications: dto.contact.receives_notifications ?? true,
                    },
                  }
                : undefined,
            },
          },
        },
        include: detailInclude,
      });
      await this.audit.write(tx, auth.tenantId, {
        action: 'student.created',
        entityType: 'student',
        entityId: student.id,
        newValue: detailView(student, true),
      });
      await this.notifyOwner(tx, auth, student);
      return this.detail(student, canSeeContacts(auth));
    });
  }

  update(id: string, dto: UpdateStudentDto) {
    const auth = RequestContextStore.auth();
    if (dto.branch_id) assertBranchAccess(auth, dto.branch_id);
    const phone = dto.phone ? requirePhone(dto.phone) : dto.phone;
    const touchesContacts = dto.phone !== undefined || dto.email !== undefined;
    if (touchesContacts && !canSeeContacts(auth)) throw AppError.forbidden("Kontaktlarni o'zgartirishga ruxsat yo'q");

    return this.db.tx(async (tx) => {
      const before = await this.find(tx, auth, id, 'student.update');
      await this.assertRefs(tx, dto);
      const blacklisted = dto.blacklisted ?? before.blacklisted;
      const student = await tx.student.update({
        where: { id },
        data: {
          branch: connect(dto.branch_id),
          owner: relink(dto.owner_id),
          adSource: relink(dto.ad_source_id),
          learningGoal: relink(dto.learning_goal_id),
          note: dto.note,
          notificationLanguage: dto.notification_language,
          blacklisted: dto.blacklisted,
          blacklistReason: blacklisted ? dto.blacklist_reason : null,
          client: {
            update: {
              fullName: dto.full_name,
              phone,
              email: dto.email === undefined ? undefined : (dto.email?.toLowerCase() ?? null),
              birthDate: dto.birth_date === undefined ? undefined : dto.birth_date ? parseDateOnly(dto.birth_date) : null,
              gender: dto.gender,
            },
          },
        },
        include: detailInclude,
      });
      await this.audit.write(tx, auth.tenantId, {
        action: 'student.updated',
        entityType: 'student',
        entityId: id,
        oldValue: detailView(before, true),
        newValue: detailView(student, true),
      });
      if (student.ownerId !== before.ownerId) await this.notifyOwner(tx, auth, student);
      return this.detail(student, canSeeContacts(auth));
    });
  }

  /** BR-S2: o'quvchi o'chirilmaydi — arxivga o'tadi */
  setArchived(id: string, archived: boolean) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const before = await this.find(tx, auth, id, 'student.archive');
      if (archived === (before.status === 'archived')) return this.detail(before, canSeeContacts(auth));
      const student = await tx.student.update({
        where: { id },
        // Arxivdan qaytganda status enrollment'lardan qayta hisoblanadi; hozircha enrollment yo'q → new (BR-S3)
        data: archived ? { status: 'archived', archivedAt: new Date() } : { status: 'new', archivedAt: null },
        include: detailInclude,
      });
      await this.audit.write(tx, auth.tenantId, {
        action: archived ? 'student.archived' : 'student.unarchived',
        entityType: 'student',
        entityId: id,
        oldValue: { status: before.status },
        newValue: { status: student.status },
      });
      return this.detail(student, canSeeContacts(auth));
    });
  }

  addContact(studentId: string, dto: ContactPersonDto) {
    const auth = this.contactsAuth();
    const phone = dto.phone ? requirePhone(dto.phone) : null;
    return this.db.tx(async (tx) => {
      const student = await this.find(tx, auth, studentId, 'student.update');
      if (dto.is_bill_recipient) await this.clearBillRecipient(tx, student.clientId);
      const contact = await tx.contactPerson.create({
        data: {
          tenantId: auth.tenantId,
          clientId: student.clientId,
          fullName: dto.full_name,
          relation: dto.relation,
          phone,
          email: dto.email?.toLowerCase() ?? null,
          isBillRecipient: dto.is_bill_recipient ?? student.client.contactPersons.length === 0,
          receivesNotifications: dto.receives_notifications ?? true,
        },
      });
      await this.audit.write(tx, auth.tenantId, {
        action: 'student.contact_added',
        entityType: 'student',
        entityId: studentId,
        newValue: contactView(contact),
      });
      return contactView(contact);
    });
  }

  updateContact(studentId: string, contactId: string, dto: UpdateContactPersonDto) {
    const auth = this.contactsAuth();
    const phone = dto.phone ? requirePhone(dto.phone) : dto.phone;
    return this.db.tx(async (tx) => {
      const before = await this.findContact(tx, auth, studentId, contactId);
      if (dto.is_bill_recipient) await this.clearBillRecipient(tx, before.clientId);
      const contact = await tx.contactPerson.update({
        where: { id: contactId },
        data: {
          fullName: dto.full_name,
          relation: dto.relation,
          phone,
          email: dto.email === undefined ? undefined : (dto.email?.toLowerCase() ?? null),
          isBillRecipient: dto.is_bill_recipient,
          receivesNotifications: dto.receives_notifications,
        },
      });
      await this.audit.write(tx, auth.tenantId, {
        action: 'student.contact_updated',
        entityType: 'student',
        entityId: studentId,
        oldValue: contactView(before),
        newValue: contactView(contact),
      });
      return contactView(contact);
    });
  }

  removeContact(studentId: string, contactId: string) {
    const auth = this.contactsAuth();
    return this.db.tx(async (tx) => {
      const contact = await this.findContact(tx, auth, studentId, contactId);
      await tx.contactPerson.delete({ where: { id: contactId } });
      await this.audit.write(tx, auth.tenantId, {
        action: 'student.contact_removed',
        entityType: 'student',
        entityId: studentId,
        oldValue: contactView(contact),
      });
    });
  }

  /** Kartochkaning "Tarix" tab'i: kim, qachon, nima qildi */
  history(id: string) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      await this.find(tx, auth, id, 'student.view');
      const rows = await tx.auditLog.findMany({
        where: { entityType: 'student', entityId: id, action: { not: 'student.contacts_viewed' } },
        orderBy: { occurredAt: 'desc' },
        take: 100,
      });
      const actorIds = [...new Set(rows.flatMap((r) => (r.actorId ? [r.actorId] : [])))];
      const actors = await tx.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } });
      const names = new Map(actors.map((a) => [a.id, a.fullName]));
      return rows.map((r) => ({
        id: r.id,
        action: r.action,
        actor: r.actorId ? (names.get(r.actorId) ?? null) : null,
        occurred_at: r.occurredAt,
        changes: diff(r.oldValue, r.newValue),
      }));
    });
  }

  /** Kartochka ko'rinishi + rasmga muddatli imzolangan havola */
  private detail(s: StudentDetail, withContacts: boolean) {
    return { ...detailView(s, withContacts), photo_url: this.files.url(s.tenantId, s.photoFileId) };
  }

  private notifyOwner(tx: Tx, auth: AuthContext, student: StudentDetail): Promise<void> {
    return this.notifier.notify(tx, [student.ownerId], {
      type: 'student.assigned',
      data: { student_id: student.id, student_name: student.client.fullName, actor_name: auth.fullName },
    });
  }

  private scope(auth: AuthContext, permission: PermissionCode): Prisma.StudentWhereInput {
    return studentScope(auth, permission);
  }

  private async find(tx: Tx, auth: AuthContext, id: string, permission: PermissionCode): Promise<StudentDetail> {
    const student = await tx.student.findFirst({ where: { AND: [{ id }, this.scope(auth, permission)] }, include: detailInclude });
    if (!student) throw AppError.notFound("O'quvchi");
    return student;
  }

  private async findContact(tx: Tx, auth: AuthContext, studentId: string, contactId: string): Promise<Contact> {
    const student = await this.find(tx, auth, studentId, 'student.update');
    const contact = student.client.contactPersons.find((c) => c.id === contactId);
    if (!contact) throw AppError.notFound('Aloqa shaxsi');
    return contact;
  }

  private contactsAuth(): AuthContext {
    const auth = RequestContextStore.auth();
    if (!canSeeContacts(auth)) throw AppError.forbidden("Kontaktlarni o'zgartirishga ruxsat yo'q");
    return auth;
  }

  /** Schyot oluvchi bitta bo'ladi */
  private async clearBillRecipient(tx: Tx, clientId: string): Promise<void> {
    await tx.contactPerson.updateMany({ where: { clientId, isBillRecipient: true }, data: { isBillRecipient: false } });
  }

  private async assertRefs(
    tx: Tx,
    dto: { branch_id?: string; owner_id?: string | null; ad_source_id?: string | null; learning_goal_id?: string | null },
  ): Promise<void> {
    if (dto.branch_id && !(await tx.branch.findFirst({ where: { id: dto.branch_id, isActive: true }, select: { id: true } }))) {
      throw AppError.field('branch_id', 'NOT_FOUND', 'Filial topilmadi yoki faol emas');
    }
    if (dto.owner_id && !(await tx.user.findFirst({ where: { id: dto.owner_id, isActive: true }, select: { id: true } }))) {
      throw AppError.field('owner_id', 'NOT_FOUND', "Mas'ul xodim topilmadi");
    }
    for (const [field, kind] of [['ad_source_id', 'ad_source'], ['learning_goal_id', 'learning_goal']] as const) {
      const id = dto[field];
      if (id && !(await tx.dictionaryItem.findFirst({ where: { id, kind }, select: { id: true } }))) {
        throw AppError.field(field, 'NOT_FOUND', "Ma'lumotnoma yozuvi topilmadi");
      }
    }
  }
}

// Nested `client` yozuvi bilan birga skalyar FK ishlatib bo'lmaydi — bog'lanishlar connect orqali
const connect = (id: string | null | undefined) => (id ? { connect: { id } } : undefined);
/** undefined = tegilmaydi, null = uziladi */
const relink = (id: string | null | undefined) => (id === null ? { disconnect: true } : connect(id));

type Json = Prisma.JsonValue;
const isObject = (v: Json | undefined): v is Prisma.JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
const label = (v: Json | undefined): Json => (isObject(v) ? ((v.name ?? v.full_name ?? null) as Json) : (v ?? null));

/** Audit yozuvidan faqat o'zgargan maydonlarni ajratadi; ichki obyektlar nomi bilan ko'rsatiladi */
function diff(oldValue: Json, newValue: Json): { field: string; from: Json; to: Json }[] {
  if (!isObject(oldValue) || !isObject(newValue)) return [];
  return Object.keys(newValue)
    .filter((key) => !['contacts', 'created_at', 'contacts_hidden', 'id'].includes(key))
    .map((field) => ({ field, from: label(oldValue[field]), to: label(newValue[field]) }))
    .filter((c) => JSON.stringify(c.from) !== JSON.stringify(c.to));
}

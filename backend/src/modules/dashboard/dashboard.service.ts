import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertBranchAccess, branchIdFilter } from '../../common/auth/scoping';
import { RequestContextStore } from '../../common/context/request-context';
import { PrismaService } from '../../common/db/prisma.service';
import { FilesService } from '../../common/files/files.service';
import { toDateOnly } from '../../common/utils/dates';

export const DASHBOARD_PERIODS = [7, 30, 90] as const;

/**
 * Ish stoli uchun o'qish modeli. Har bir blok foydalanuvchining ruxsati va scope'iga qarab to'ldiriladi;
 * ruxsat bo'lmasa blok null qaytadi (frontend uni ko'rsatmaydi).
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly db: PrismaService,
    private readonly files: FilesService,
  ) {}

  summary(branchId?: string, days: number = 30) {
    const auth = RequestContextStore.auth();
    const DAYS = days;
    const can = (code: keyof typeof auth.permissions): boolean => Boolean(auth.permissions[code]);
    // Bitta filial tanlansa — faqat shu filial (ruxsat doirasida); aks holda foydalanuvchining barcha filiallari
    if (branchId) assertBranchAccess(auth, branchId);
    const branchIn = branchId ? { in: [branchId] } : branchIdFilter(auth);
    const studentScope: Prisma.StudentWhereInput = {
      mergedIntoId: null,
      branchId: branchIn,
      ownerId: auth.permissions['student.view'] === 'own' ? auth.userId : undefined,
    };

    return this.db.tx(async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { timezone: true } });

      const students = can('student.view')
        ? await (async () => {
            const byStatus = await tx.student.groupBy({ by: ['status'], where: studentScope, _count: true });
            const byBranch = await tx.student.groupBy({
              by: ['branchId'],
              where: { ...studentScope, status: { not: 'archived' } },
              _count: true,
            });
            const branches = await tx.branch.findMany({
              where: { id: { in: byBranch.map((b) => b.branchId) } },
              select: { id: true, name: true },
            });
            // Kun chegarasi tenant vaqt zonasida (TZ 11.5), UTC'da emas
            const branchSql = branchIn ? Prisma.sql`AND s.branch_id = ANY(${branchIn.in}::uuid[])` : Prisma.empty;
            const ownerSql = studentScope.ownerId ? Prisma.sql`AND s.owner_id = ${auth.userId}::uuid` : Prisma.empty;
            const daily = await tx.$queryRaw<{ day: Date; count: number }[]>`
              SELECT d::date AS day, count(s.id)::int AS count
              FROM generate_series(
                     (now() AT TIME ZONE ${tenant.timezone})::date - ${DAYS - 1}::int,
                     (now() AT TIME ZONE ${tenant.timezone})::date, interval '1 day') AS d
              LEFT JOIN students s
                ON (s.created_at AT TIME ZONE ${tenant.timezone})::date = d::date
               AND s.merged_into_id IS NULL ${branchSql} ${ownerSql}
              GROUP BY d ORDER BY d`;
            const months = await tx.$queryRaw<{ this_month: number; prev_month: number }[]>`
              SELECT
                count(*) FILTER (WHERE date_trunc('month', s.created_at AT TIME ZONE ${tenant.timezone})
                                     = date_trunc('month', now() AT TIME ZONE ${tenant.timezone}))::int AS this_month,
                count(*) FILTER (WHERE date_trunc('month', s.created_at AT TIME ZONE ${tenant.timezone})
                                     = date_trunc('month', now() AT TIME ZONE ${tenant.timezone}) - interval '1 month')::int AS prev_month
              FROM students s
              WHERE s.merged_into_id IS NULL ${branchSql} ${ownerSql}`;
            const count = (status: string): number => byStatus.find((s) => s.status === status)?._count ?? 0;
            const names = new Map(branches.map((b) => [b.id, b.name]));
            return {
              total: byStatus.reduce((sum, s) => sum + (s.status === 'archived' ? 0 : s._count), 0),
              by_status: { new: count('new'), active: count('active'), paused: count('paused'), finished: count('finished'), archived: count('archived') },
              new_this_month: months[0]?.this_month ?? 0,
              new_prev_month: months[0]?.prev_month ?? 0,
              daily: daily.map((d) => ({ date: toDateOnly(d.day), count: d.count })),
              by_branch: byBranch
                .map((b) => ({ branch: names.get(b.branchId) ?? '—', count: b._count }))
                .sort((a, b) => b.count - a.count),
            };
          })()
        : null;

      const company = can('branch.view')
        ? {
            branches: await tx.branch.count({ where: { id: branchIn, isActive: true } }),
            classrooms: await tx.classroom.count({ where: { branchId: branchIn, isActive: true, branch: { isActive: true } } }),
          }
        : null;

      const employees = can('employee.view')
        ? await tx.user.count({
            where: {
              isActive: true,
              roles: { some: { role: { code: { notIn: ['student', 'parent'] } } } },
              branches: branchIn ? { some: { branchId: branchIn } } : undefined,
            },
          })
        : null;

      // Oxirgi qo'shilgan o'quvchilar (kontakt ruxsati bo'lmasa telefon yashiriladi)
      const recent = can('student.view')
        ? await tx.student.findMany({
            where: { ...studentScope, status: { not: 'archived' } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 6,
            select: { id: true, number: true, status: true, createdAt: true, photoFileId: true, client: { select: { fullName: true, phone: true } }, branch: { select: { name: true } } },
          })
        : null;

      // Bugungi darslar, 30 kunlik davomat foizi va shu oydagi tushum — tegishli ruxsat bo'lsa
      const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: tenant.timezone }).format(new Date());
      const unitScope: Prisma.StudyUnitWhereInput = { branchId: branchIn, teacherId: auth.permissions['schedule.view'] === 'own' ? auth.userId : undefined };
      const lessonsToday = can('schedule.view')
        ? await tx.lesson.groupBy({ by: ['status'], where: { date: new Date(`${todayStr}T00:00:00Z`), studyUnit: unitScope }, _count: true })
        : null;
      // Bugungi darslar lentasi: vaqt, guruh, o'qituvchi, xona va davomat holati
      const feed = can('schedule.view')
        ? await tx.lesson.findMany({
            where: { date: new Date(`${todayStr}T00:00:00Z`), studyUnit: unitScope },
            orderBy: { startAt: 'asc' },
            take: 40,
            select: {
              id: true, startAt: true, endAt: true, status: true,
              studyUnit: { select: { name: true, discipline: { select: { name: true } }, _count: { select: { enrollments: { where: { endDate: null } } } } } },
              teacher: { select: { fullName: true } },
              classroom: { select: { name: true } },
              _count: { select: { attendances: true } },
            },
          })
        : null;
      const marks = can('attendance.view')
        ? await tx.attendance.groupBy({ by: ['status'], where: { lesson: { date: { gte: new Date(Date.now() - 30 * 86_400_000) }, studyUnit: unitScope } }, _count: true })
        : null;
      const marked = marks?.reduce((sum, m) => sum + m._count, 0) ?? 0;
      const revenue = can('finance.view_amounts')
        ? await tx.$queryRaw<{ amount: bigint | null; payments: number }[]>`
            SELECT sum(l.amount) AS amount, count(*)::int AS payments
            FROM ledger_entries l JOIN students s ON s.id = l.student_id
            WHERE l.entry_type = 'payment'
              AND date_trunc('month', l.occurred_at AT TIME ZONE ${tenant.timezone}) = date_trunc('month', now() AT TIME ZONE ${tenant.timezone})
              ${branchIn ? Prisma.sql`AND s.branch_id = ANY(${branchIn.in}::uuid[])` : Prisma.empty}`
        : null;

      // Lidlar: yangi (hali bog'lanilmagan) va jarayondagilar
      const leadRows = can('lead.view')
        ? await tx.lead.groupBy({ by: ['stage'], where: { branchId: branchIn, ownerId: auth.permissions['lead.view'] === 'own' ? auth.userId : undefined }, _count: true })
        : null;
      const leadCount = (...stages: string[]): number => (leadRows ?? []).filter((r) => stages.includes(r.stage)).reduce((sum, r) => sum + r._count, 0);

      return {
        students,
        leads: leadRows && { new: leadCount('new'), in_progress: leadCount('contacted', 'trial', 'contract') },
        lessons_today: lessonsToday && {
          total: lessonsToday.reduce((sum, l) => sum + (l.status === 'cancelled' ? 0 : l._count), 0),
          completed: lessonsToday.find((l) => l.status === 'completed')?._count ?? 0,
        },
        today: feed?.map((l) => ({
          id: l.id,
          start_at: l.startAt,
          end_at: l.endAt,
          status: l.status,
          group: l.studyUnit.name,
          discipline: l.studyUnit.discipline.name,
          teacher: l.teacher.fullName,
          classroom: l.classroom?.name ?? null,
          students: l.studyUnit._count.enrollments,
          marked: l._count.attendances,
        })) ?? null,
        attendance: marks && { marked, rate: marked ? Math.round(((marks.filter((m) => m.status === 'present' || m.status === 'late').reduce((sum, m) => sum + m._count, 0)) / marked) * 100) : null },
        revenue: revenue && { month: Number(revenue[0]?.amount ?? 0n), payments: revenue[0]?.payments ?? 0 },
        company,
        employees,
        recent_students:
          recent?.map((r) => ({
            id: r.id,
            number: r.number,
            full_name: r.client.fullName,
            photo_url: this.files.url(auth.tenantId, r.photoFileId),
            phone: can('student.view_contacts') ? r.client.phone : null,
            branch: r.branch.name,
            status: r.status,
            created_at: r.createdAt,
          })) ?? null,
      };
    });
  }
}

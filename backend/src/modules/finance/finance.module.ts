import { Body, Controller, Get, HttpCode, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AlertService } from '../../common/alerts/alert.service';
import { AuditService } from '../../common/audit/audit.service';
import { RequirePermission } from '../../common/auth/decorators';
import { RequestContextStore } from '../../common/context/request-context';
import { PrismaService } from '../../common/db/prisma.service';
import { AppError } from '../../common/http/app-error';
import { parseDateOnly, toDateOnly } from '../../common/utils/dates';
import { todayIn, zonedToUtc } from '../academic/domain';
import { studentScope } from '../students/students.service';
import { nextNumber } from '../../common/db/sequences';
import { queueReceipt, receiptNo } from '../messaging/notices';
import { addMonths, chargeSubscriptions, postEntry } from './ledger';

export const PAYMENT_METHODS = ['cash', 'card', 'payme', 'click', 'bank'] as const;
const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

class CreatePaymentDto {
  @IsUUID() student_id!: string;
  /** Tiyinda, musbat */
  @IsInt() @Min(100) @Max(100_000_000_000) amount!: number;
  @IsIn(PAYMENT_METHODS) method!: (typeof PAYMENT_METHODS)[number];
  /** Biznes sanasi; ko'rsatilmasa bugun */
  @IsOptional() @IsDateString({ strict: true }) date?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(300) comment?: string;
}

class CancelPaymentDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(200) reason!: string;
}

class PaymentQuery {
  @IsOptional() @IsDateString({ strict: true }) from?: string;
  @IsOptional() @IsDateString({ strict: true }) to?: string;
  @IsOptional() @IsUUID() branch_id?: string;
  @IsOptional() @IsIn(PAYMENT_METHODS) method?: (typeof PAYMENT_METHODS)[number];
}

class BalanceQuery {
  /** all — hammasi; paid — shu oyda to'laganlar; unpaid — shu oyda to'lamaganlar; debtors — balansi manfiy */
  @IsOptional() @IsIn(['all', 'paid', 'unpaid', 'debtors']) filter?: 'all' | 'paid' | 'unpaid' | 'debtors';
  @IsOptional() @IsUUID() branch_id?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80) q?: string;
}

class SummaryQuery {
  @IsOptional() @IsUUID() branch_id?: string;
}

@Injectable()
export class FinanceService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Oy boshi va bugun — tenant vaqt zonasida */
  private async period(tx: Prisma.TransactionClient) {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: RequestContextStore.auth().tenantId }, select: { timezone: true } });
    const today = todayIn(tenant.timezone);
    return { timeZone: tenant.timezone, today, todayStart: zonedToUtc(today, '00:00', tenant.timezone), monthStart: zonedToUtc(`${today.slice(0, 8)}01`, '00:00', tenant.timezone) };
  }

  createPayment(dto: CreatePaymentDto) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const student = await tx.student.findFirst({ where: { AND: [{ id: dto.student_id }, studentScope(auth, 'student.view')] }, select: { id: true, client: { select: { fullName: true } } } });
      if (!student) throw AppError.field('student_id', 'NOT_FOUND', "O'quvchi topilmadi");
      const { timeZone, today } = await this.period(tx);
      const date = dto.date?.slice(0, 10) ?? today;
      if (date > today) throw AppError.field('date', 'IN_FUTURE', "To'lov sanasi kelajakda bo'lishi mumkin emas");
      // Bugungi to'lov — hozirgi vaqt bilan, o'tgan sana — o'sha kunning tushi bilan
      const occurredAt = date === today ? new Date() : zonedToUtc(date, '12:00', timeZone);
      const entry = await postEntry(tx, auth.tenantId, { studentId: student.id, entryType: 'payment', amount: BigInt(dto.amount), occurredAt, sourceType: 'manual', method: dto.method, comment: dto.comment, receiptNumber: await nextNumber(tx, auth.tenantId, 'receipt'), createdBy: auth.userId });
      const balance = (await tx.student.findUniqueOrThrow({ where: { id: student.id }, select: { cachedBalance: true } })).cachedBalance;
      // Barcha moliyaviy operatsiyalar audit log'ga yoziladi (M11.3)
      await this.audit.write(tx, auth.tenantId, { action: 'payment.created', entityType: 'student', entityId: student.id, newValue: { full_name: student.client.fullName, amount: dto.amount, method: dto.method, date } });
      // Ota-onaga Telegram chek (botga ulangan va sozlamada yoqilgan bo'lsa)
      const receiptSent = await queueReceipt(tx, auth.tenantId, entry, date, auth.userId);
      return { id: entry.id, balance: Number(balance), receipt_number: receiptNo(entry.receiptNumber, entry.id), receipt_sent: receiptSent > 0 };
    });
  }

  /**
   * Xato kiritilgan to'lovni bekor qilish. Ledger o'zgartirilmaydi: teskari yozuv qo'shiladi (storno), balans qaytadi.
   * Teskari yozuv asl to'lov sanasi bilan yoziladi — o'sha davr tushumi ham to'g'rilanadi.
   */
  cancelPayment(id: string, dto: CancelPaymentDto) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const entry = await tx.ledgerEntry.findFirst({ where: { id, entryType: 'payment', reversesEntryId: null, student: studentScope(auth, 'student.view') }, include: { student: { select: { client: { select: { fullName: true } } } } } });
      if (!entry) throw AppError.notFound("To'lov");
      if (await tx.ledgerEntry.findFirst({ where: { reversesEntryId: id }, select: { id: true } })) throw AppError.conflict("Bu to'lov allaqachon bekor qilingan", 'ALREADY_CANCELLED');
      await postEntry(tx, auth.tenantId, { studentId: entry.studentId, entryType: 'payment', amount: -entry.amount, occurredAt: entry.occurredAt, sourceType: 'manual', method: entry.method, reversesEntryId: id, comment: dto.reason, createdBy: auth.userId });
      // Hali yuborilmagan Telegram chek ham bekor bo'ladi
      await tx.messageLog.deleteMany({ where: { kind: 'receipt', refId: id, status: 'queued' } });
      const balance = (await tx.student.findUniqueOrThrow({ where: { id: entry.studentId }, select: { cachedBalance: true } })).cachedBalance;
      await this.audit.write(tx, auth.tenantId, { action: 'payment.cancelled', entityType: 'student', entityId: entry.studentId, newValue: { full_name: entry.student.client.fullName, amount: Number(entry.amount), reason: dto.reason } });
      return { balance: Number(balance) };
    });
  }

  /** Bekor qilingan to'lovlar va ularning teskari yozuvlari ro'yxat va hisob-kitobga kirmaydi */
  private async validPayments(tx: Prisma.TransactionClient): Promise<Prisma.LedgerEntryWhereInput> {
    const reversals = await tx.ledgerEntry.findMany({ where: { entryType: 'payment', reversesEntryId: { not: null } }, select: { reversesEntryId: true } });
    return { entryType: 'payment', reversesEntryId: null, id: { notIn: reversals.map((r) => r.reversesEntryId as string) } };
  }

  listPayments(query: PaymentQuery) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const { timeZone } = await this.period(tx);
      const rows = await tx.ledgerEntry.findMany({
        where: {
          ...(await this.validPayments(tx)),
          method: query.method,
          occurredAt: { gte: query.from ? zonedToUtc(query.from.slice(0, 10), '00:00', timeZone) : undefined, lt: query.to ? new Date(zonedToUtc(query.to.slice(0, 10), '00:00', timeZone).getTime() + 86_400_000) : undefined },
          student: { AND: [studentScope(auth, 'student.view'), { branchId: query.branch_id }] },
        },
        orderBy: { occurredAt: 'desc' },
        take: 300,
        include: { student: { select: { id: true, number: true, client: { select: { fullName: true } }, branch: { select: { name: true } } } } },
      });
      const users = await tx.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => (r.createdBy ? [r.createdBy] : [])))] } }, select: { id: true, fullName: true } });
      const names = new Map(users.map((u) => [u.id, u.fullName]));
      return rows.map((r) => ({
        id: r.id,
        receipt_number: receiptNo(r.receiptNumber, r.id),
        occurred_at: r.occurredAt,
        amount: Number(r.amount),
        method: r.method,
        comment: r.comment,
        student: { id: r.student.id, number: r.student.number, full_name: r.student.client.fullName, branch: r.student.branch.name },
        created_by: r.createdBy ? (names.get(r.createdBy) ?? null) : null,
      }));
    });
  }

  /** Chop etiladigan chek (kvitansiya) ma'lumoti */
  receipt(id: string) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const entry = await tx.ledgerEntry.findFirst({
        where: { id, entryType: 'payment', student: studentScope(auth, 'student.view') },
        include: { student: { select: { id: true, number: true, client: { select: { fullName: true } }, branch: { select: { name: true, address: true, phone: true } }, enrollments: { where: { endDate: null }, select: { studyUnit: { select: { number: true, name: true } } } } } } },
      });
      if (!entry) throw AppError.notFound("To'lov");
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { name: true } });
      const cashier = entry.createdBy ? await tx.user.findFirst({ where: { id: entry.createdBy }, select: { fullName: true } }) : null;
      return {
        id: entry.id,
        number: receiptNo(entry.receiptNumber, entry.id),
        occurred_at: entry.occurredAt,
        amount: Number(entry.amount),
        method: entry.method,
        comment: entry.comment,
        center: tenant.name,
        branch: entry.student.branch,
        student: { id: entry.student.id, number: entry.student.number, full_name: entry.student.client.fullName },
        groups: entry.student.enrollments.map((e) => `${e.studyUnit.number} · ${e.studyUnit.name}`),
        cashier: cashier?.fullName ?? null,
      };
    });
  }

  summary(query: SummaryQuery) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const { todayStart, monthStart } = await this.period(tx);
      const students: Prisma.StudentWhereInput = { AND: [studentScope(auth, 'student.view'), { branchId: query.branch_id }] };
      const valid = await this.validPayments(tx);
      const [month, today, debt, studentsTotal, paidStudents] = await Promise.all([
        tx.ledgerEntry.aggregate({ where: { ...valid, occurredAt: { gte: monthStart }, student: students }, _sum: { amount: true }, _count: true }),
        tx.ledgerEntry.aggregate({ where: { ...valid, occurredAt: { gte: todayStart }, student: students }, _sum: { amount: true }, _count: true }),
        tx.student.aggregate({ where: { AND: [students, { cachedBalance: { lt: 0 }, status: { not: 'archived' } }] }, _sum: { cachedBalance: true }, _count: true }),
        tx.student.count({ where: { AND: [students, { status: { in: ['active', 'paused'] } }] } }),
        tx.ledgerEntry.findMany({ where: { ...valid, occurredAt: { gte: monthStart }, student: students }, select: { studentId: true }, distinct: ['studentId'] }),
      ]);
      const monthSum = Number(month._sum.amount ?? 0n);
      return {
        month_revenue: monthSum,
        month_payments: month._count,
        today_revenue: Number(today._sum.amount ?? 0n),
        today_payments: today._count,
        total_debt: -Number(debt._sum.cachedBalance ?? 0n),
        debtors: debt._count,
        average_payment: month._count ? Math.round(monthSum / month._count) : 0,
        active_students: studentsTotal,
        paid_students: paidStudents.length,
      };
    });
  }

  /** O'quvchilar kesimida: balans, shu oyda to'lagani, oxirgi to'lov, guruhlari */
  balances(query: BalanceQuery) {
    const auth = RequestContextStore.auth();
    const filter = query.filter ?? 'all';
    return this.db.tx(async (tx) => {
      const { monthStart } = await this.period(tx);
      const paidThisMonth: Prisma.StudentWhereInput = { ledger: { some: { entryType: 'payment', occurredAt: { gte: monthStart } } } };
      const where: Prisma.StudentWhereInput = {
        AND: [
          studentScope(auth, 'student.view'),
          { branchId: query.branch_id, status: { not: 'archived' } },
          query.q ? { OR: [{ client: { fullName: { contains: query.q, mode: 'insensitive' } } }, ...(/^#?\d{1,9}$/.test(query.q) ? [{ number: Number(query.q.replace(/\D/g, '')) }] : [])] } : {},
          filter === 'debtors' ? { cachedBalance: { lt: 0 } } : filter === 'paid' ? paidThisMonth : filter === 'unpaid' ? { status: { in: ['active', 'paused'] }, NOT: paidThisMonth } : {},
        ],
      };
      const rows = await tx.student.findMany({
        where,
        orderBy: filter === 'debtors' ? [{ cachedBalance: 'asc' }] : [{ createdAt: 'desc' }],
        take: 300,
        select: {
          id: true, number: true, status: true, cachedBalance: true,
          client: { select: { fullName: true, phone: true } },
          branch: { select: { name: true } },
          enrollments: { where: { endDate: null }, select: { priceAmount: true, startDate: true, studyUnit: { select: { name: true, status: true } } } },
          ledger: { where: { entryType: 'payment' }, orderBy: { occurredAt: 'desc' }, take: 1, select: { occurredAt: true } },
        },
      });
      const paid = await tx.ledgerEntry.groupBy({ by: ['studentId'], where: { entryType: 'payment', occurredAt: { gte: monthStart }, studentId: { in: rows.map((r) => r.id) } }, _sum: { amount: true } });
      const paidBy = new Map(paid.map((p) => [p.studentId, Number(p._sum.amount ?? 0n)]));
      // Eslatma yuborish mumkinmi: ota-onasi botga ulanganlar
      const links = await tx.messengerLink.findMany({ where: { blockedAt: null, contactPerson: { receivesNotifications: true, client: { student: { id: { in: rows.map((r) => r.id) } } } } }, select: { contactPerson: { select: { client: { select: { student: { select: { id: true } } } } } } } });
      const linked = new Set(links.flatMap((l) => (l.contactPerson.client.student ? [l.contactPerson.client.student.id] : [])));
      const canContacts = Boolean(auth.permissions['student.view_contacts']);
      return rows.map((s) => {
        const price = s.enrollments.reduce((sum, e) => sum + e.priceAmount, 0n);
        // Keyingi abonement oyi qachon boshlanadi (eng yaqini) — keyingi to'lov sanasi
        const now = new Date();
        const next = s.enrollments
          .filter((e) => e.studyUnit.status === 'active')
          .map((e) => {
            let k = 1;
            while (addMonths(e.startDate, k) <= now && k < 240) k++;
            return addMonths(e.startDate, k);
          })
          .sort((a, b) => a.getTime() - b.getTime())[0];
        return {
          id: s.id,
          number: s.number,
          full_name: s.client.fullName,
          phone: canContacts ? s.client.phone : null,
          branch: s.branch.name,
          status: s.status,
          groups: s.enrollments.map((e) => e.studyUnit.name),
          balance: Number(s.cachedBalance),
          monthly_price: Number(price),
          // Balans necha oylik abonementga teng: |balans| ÷ oylik narx, pastga yaxlitlanadi
          months: price > 0n ? Number((s.cachedBalance < 0n ? -s.cachedBalance : s.cachedBalance) / price) : null,
          next_payment_date: next ? toDateOnly(next) : null,
          paid_this_month: paidBy.get(s.id) ?? 0,
          last_payment_at: s.ledger[0]?.occurredAt ?? null,
          telegram_linked: linked.has(s.id),
        };
      });
    });
  }

  ledger(studentId: string) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const student = await tx.student.findFirst({ where: { AND: [{ id: studentId }, studentScope(auth, 'student.view')] }, select: { cachedBalance: true } });
      if (!student) throw AppError.notFound("O'quvchi");
      const rows = await tx.ledgerEntry.findMany({ where: { studentId }, orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }], take: 300 });
      const cancelled = new Set(rows.flatMap((r) => (r.reversesEntryId ? [r.reversesEntryId] : [])));
      return {
        balance: Number(student.cachedBalance),
        entries: rows.map((r) => ({
          id: r.id,
          // subscription — oylik abonement yechimi; izohida guruh va davr
          type: r.reversesEntryId ? (r.entryType === 'payment' ? 'payment_cancel' : 'reversal') : r.sourceType === 'subscription' ? 'subscription' : r.entryType,
          cancelled: cancelled.has(r.id),
          amount: Number(r.amount),
          occurred_at: r.occurredAt,
          method: r.method,
          comment: r.comment,
        })),
      };
    });
  }
}

/**
 * Reconciliation (TZ M6.4): balans keshi ledger yig'indisiga teng bo'lishi shart. Farq — kritik hodisa:
 * pul hisobi buzilgan degani, shuning uchun darhol xato botiga xabar beriladi.
 */
@Injectable()
export class ReconciliationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Reconciliation');
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly db: PrismaService,
    private readonly alerts: AlertService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    const run = () => void this.run().catch((e) => this.logger.error(e));
    this.timers.push(setTimeout(run, 60_000), setInterval(run, 6 * 3_600_000));
  }

  onModuleDestroy(): void {
    this.timers.forEach((timer) => clearTimeout(timer));
  }

  /** Har bir tenant bo'yicha nomuvofiq o'quvchilar soni */
  async run(): Promise<number> {
    let total = 0;
    for (const tenant of await this.db.tenant.findMany({ where: { isActive: true }, select: { id: true, name: true } })) {
      const rows = await this.db.tx(
        (tx) => tx.$queryRaw<{ mismatched: number; difference: bigint | null }[]>`
          SELECT count(*)::int AS mismatched, sum(abs(s.cached_balance - COALESCE(l.total, 0))) AS difference
          FROM students s
          LEFT JOIN (SELECT student_id, sum(amount) AS total FROM ledger_entries GROUP BY student_id) l ON l.student_id = s.id
          WHERE s.cached_balance <> COALESCE(l.total, 0)`,
        tenant.id,
      );
      const mismatched = rows[0]?.mismatched ?? 0;
      if (mismatched > 0) {
        total += mismatched;
        this.alerts.send('critical', 'Balans ledger bilan mos kelmayapti', [`Tashkilot: ${tenant.name}`, `Nomuvofiq o'quvchilar: ${mismatched}`, `Jami farq: ${Math.round(Number(rows[0]?.difference ?? 0n) / 100)} so'm`], `reconciliation:${tenant.id}`);
      }
    }
    return total;
  }
}

/** Har soatda: boshlangan abonement oylari uchun yechimlarni yozadi (yangi oy boshlangan a'zoliklar) */
@Injectable()
export class SubscriptionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Subscriptions');
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly db: PrismaService,
    private readonly alerts: AlertService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    const run = () =>
      void this.run().catch((e) => {
        this.logger.error(e);
        this.alerts.send('critical', 'Oylik abonement hisoblanmadi', [e instanceof Error ? e.message.slice(0, 300) : 'xato'], 'subscriptions-failed');
      });
    this.timers.push(setTimeout(run, 20_000), setInterval(run, 3_600_000));
  }

  onModuleDestroy(): void {
    this.timers.forEach((timer) => clearTimeout(timer));
  }

  async run(now: Date = new Date()): Promise<number> {
    let created = 0;
    for (const tenant of await this.db.tenant.findMany({ where: { isActive: true }, select: { id: true, timezone: true } })) {
      created += await this.db.tx((tx) => chargeSubscriptions(tx, tenant.id, todayIn(tenant.timezone, now)), tenant.id);
    }
    if (created) this.logger.log(`${created} ta abonement yechimi yozildi`);
    return created;
  }
}

@Controller()
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @RequirePermission('payment.create')
  @Post('payments')
  createPayment(@Body() dto: CreatePaymentDto) {
    return this.finance.createPayment(dto);
  }

  @RequirePermission('payment.view')
  @Get('payments')
  listPayments(@Query() query: PaymentQuery) {
    return this.finance.listPayments(query);
  }

  @RequirePermission('payment.delete')
  @Post('payments/:id/cancel')
  @HttpCode(200)
  cancelPayment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelPaymentDto) {
    return this.finance.cancelPayment(id, dto);
  }

  @RequirePermission('payment.view')
  @Get('payments/:id/receipt')
  receipt(@Param('id', ParseUUIDPipe) id: string) {
    return this.finance.receipt(id);
  }

  // Umumiy moliyaviy manzara: to'lov qabul qiluvchi administrator buni ko'rmasligi mumkin (TZ 3.4)
  @RequirePermission('finance.view_amounts')
  @Get('finance/summary')
  summary(@Query() query: SummaryQuery) {
    return this.finance.summary(query);
  }

  @RequirePermission('ledger.view')
  @Get('finance/balances')
  balances(@Query() query: BalanceQuery) {
    return this.finance.balances(query);
  }

  @RequirePermission('ledger.view')
  @Get('students/:id/ledger')
  ledger(@Param('id', ParseUUIDPipe) id: string) {
    return this.finance.ledger(id);
  }
}

@Module({ controllers: [FinanceController], providers: [FinanceService, ReconciliationService, SubscriptionService] })
export class FinanceModule {}

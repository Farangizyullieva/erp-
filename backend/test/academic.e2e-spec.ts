import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ReconciliationService, SubscriptionService } from '../src/modules/finance/finance.module';
import { api, createApp, createTenant, Fixture, nextPhone, owner, tokenFor } from './helpers';

const DAY = 86_400_000;
const iso = (offsetDays: number): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(Date.now() + offsetDays * DAY));
const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
const PRICE = 5_000_000; // 50 000 so'm, tiyinda

describe('groups, schedule, attendance and finance (e2e)', () => {
  let app: INestApplication;
  let fx: Fixture;
  let other: Fixture;
  let token: string;
  let discipline: string;
  let room: string;
  const appRole = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

  const everyDay = (start: string, end: string, from = -14, to = 14) => ({ days: [1, 2, 3, 4, 5, 6, 7], start_time: start, end_time: end, period_start: iso(from), period_end: iso(to) });
  const newUnit = (name: string, extra: object = {}) =>
    api(app, token).post('/study-units', { name, branch_id: fx.branches.a, discipline_id: discipline, teacher_id: fx.users.teacher.id, classroom_id: room, capacity: 2, price_amount: PRICE, ...extra });
  const newStudent = async (name: string) => (await api(app, token).post('/students', { full_name: name, branch_id: fx.branches.a, phone: nextPhone() })).body.data as { id: string };
  const balanceOf = async (id: string) => (await api(app, token).get(`/students/${id}`)).body.data.balance as number;
  const lessonOn = async (unitId: string, date: string) => ((await api(app, token).get(`/lessons?from=${date}&to=${date}&study_unit_id=${unitId}`)).body.data as { id: string; status: string }[])[0]!;

  beforeAll(async () => {
    app = await createApp();
    [fx, other] = await Promise.all([createTenant(), createTenant()]);
    token = await tokenFor(app, fx, 'owner');
    discipline = (await api(app, token).post('/dictionaries', { kind: 'discipline', name: 'Ingliz tili' })).body.data.id;
    room = (await api(app, token).post(`/branches/${fx.branches.a}/classrooms`, { name: '101', capacity: 12 })).body.data.id;
  });

  afterAll(async () => {
    await app.close();
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
  });

  describe('schedule generation and conflicts', () => {
    it('materialises lessons on the chosen weekdays and skips holidays', async () => {
      const holiday = iso(3);
      await api(app, token).post('/holidays', { date: holiday, name: 'Bayram' });
      const days = [weekdayOf(iso(1)), weekdayOf(iso(3)), weekdayOf(iso(5))];
      const res = await newUnit('GEN-01', { schedule: { days, start_time: '09:00', end_time: '10:30', period_start: iso(0), period_end: iso(6) } });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ status: 'active', lessons_created: 2 });

      const lessons = (await api(app, token).get(`/lessons?from=${iso(0)}&to=${iso(6)}&study_unit_id=${res.body.data.id}`)).body.data;
      expect(lessons.map((l: { date: string }) => l.date)).toEqual([iso(1), iso(5)]);
      // 09:00 Toshkent = 04:00 UTC
      expect(lessons[0].start_at).toBe(`${iso(1)}T04:00:00.000Z`);
      expect(lessons[0]).toMatchObject({ status: 'planned', teacher: { full_name: 'Teacher' }, classroom: { name: '101' } });
    });

    it('blocks a teacher or classroom from being in two places at once', async () => {
      expect((await newUnit('CONF-A', { schedule: everyDay('12:00', '13:30', 20, 26) })).status).toBe(201);

      const sameTeacher = await newUnit('CONF-B', { classroom_id: undefined, schedule: everyDay('13:00', '14:00', 20, 26) });
      expect(sameTeacher.status).toBe(409);
      expect(sameTeacher.body.error.code).toBe('SCHEDULE_CONFLICT');
      expect(sameTeacher.body.error.message).toContain('CONF-A');

      const sameRoom = await newUnit('CONF-C', { teacher_id: fx.users.sales.id, schedule: everyDay('12:30', '13:00', 20, 26) });
      expect(sameRoom.status).toBe(409);
      expect(sameRoom.body.error.message).toContain('Xona band');
      // Muvaffaqiyatsiz urinish hech narsa qoldirmaydi (bitta transaction)
      expect((await api(app, token).get('/study-units?q=CONF-')).body.data.map((u: { name: string }) => u.name)).toEqual(['CONF-A']);

      // Ketma-ket darslar to'qnashmaydi: 13:30 da boshlanadigan dars 13:30 da tugaydigan bilan yonma-yon
      expect((await newUnit('CONF-D', { schedule: everyDay('13:30', '15:00', 20, 26) })).status).toBe(201);
    });

    it('enforces the overlap rule in the database itself', async () => {
      const unit = (await newUnit('DB-01', { classroom_id: undefined, schedule: everyDay('07:00', '08:00', 30, 30) })).body.data;
      const lesson = await lessonOn(unit.id, iso(30));
      const row = await owner.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${fx.tenantId}, true)`;
        return tx.lesson.findUniqueOrThrow({ where: { id: lesson.id } });
      });
      // Ilova tekshiruvini chetlab, to'g'ridan-to'g'ri yozishga urinish
      await expect(
        appRole.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_tenant', ${fx.tenantId}, true)`;
          await tx.lesson.create({ data: { tenantId: fx.tenantId, studyUnitId: unit.id, date: row.date, startAt: new Date(row.startAt.getTime() + 15 * 60_000), endAt: new Date(row.endAt.getTime() + 15 * 60_000), teacherId: row.teacherId } });
        }),
      ).rejects.toThrow(/lessons_teacher_no_overlap/);
    });

    it('frees the slot when a lesson is cancelled and regenerates only future lessons', async () => {
      const unit = (await newUnit('REGEN-01', { classroom_id: undefined, schedule: everyDay('20:00', '21:00', -3, 3) })).body.data;
      const past = await lessonOn(unit.id, iso(-2));
      const student = await newStudent('Regen Student');
      await api(app, token).post(`/study-units/${unit.id}/members`, { student_id: student.id, start_date: iso(-3) });
      await api(app, token).put(`/lessons/${past.id}/attendance`, { entries: [{ student_id: student.id, status: 'present' }] });

      const changed = await api(app, token).put(`/study-units/${unit.id}/schedule`, everyDay('21:00', '22:00', -3, 3));
      expect(changed.status).toBe(200);
      const all = (await api(app, token).get(`/lessons?from=${iso(-3)}&to=${iso(3)}&study_unit_id=${unit.id}`)).body.data as { date: string; start_at: string }[];
      // O'tgan darslar eski vaqtda qoladi, bugundan boshlab yangi vaqt
      expect(all.find((l) => l.date === iso(-2))?.start_at).toBe(`${iso(-2)}T15:00:00.000Z`);
      expect(all.find((l) => l.date === iso(2))?.start_at).toBe(`${iso(2)}T16:00:00.000Z`);

      const target = await lessonOn(unit.id, iso(2));
      const clash = { study_unit_id: unit.id, date: iso(2), start_time: '21:30', end_time: '22:30' };
      expect((await api(app, token).post('/lessons', clash)).status).toBe(409);
      expect((await api(app, token).post(`/lessons/${target.id}/cancel`, { reason: "O'qituvchi kasal" })).body.data.status).toBe('cancelled');
      expect((await api(app, token).post('/lessons', clash)).status).toBe(201);
    });
  });

  describe('membership', () => {
    it('adds members, warns over capacity and derives the student status', async () => {
      const unit = (await newUnit('MEM-01', { classroom_id: undefined, schedule: everyDay('06:00', '06:30', 40, 41) })).body.data;
      const [a, b, c] = await Promise.all([newStudent('Member A'), newStudent('Member B'), newStudent('Member C')]);
      expect((await api(app, token).post(`/study-units/${unit.id}/members`, { student_id: a!.id })).body.data.over_capacity).toBe(false);
      expect((await api(app, token).post(`/study-units/${unit.id}/members`, { student_id: a!.id })).body.error.code).toBe('ALREADY_MEMBER');
      await api(app, token).post(`/study-units/${unit.id}/members`, { student_id: b!.id });
      // Sig'im 2: uchinchisi qo'shiladi, lekin ogohlantirish bilan (BR-U3)
      expect((await api(app, token).post(`/study-units/${unit.id}/members`, { student_id: c!.id })).body.data.over_capacity).toBe(true);
      expect((await api(app, token).get(`/students/${a!.id}`)).body.data.status).toBe('active');

      const detail = (await api(app, token).get(`/study-units/${unit.id}`)).body.data;
      expect(detail.students_count).toBe(3);
      const enrollment = detail.members.find((m: { student: { id: string } }) => m.student.id === a!.id).enrollment_id;
      // Qo'shilganda birinchi oy hisoblangan; davomati yo'q (xato qo'shilgan) a'zolik olib tashlansa — storno
      expect(await balanceOf(a!.id)).toBe(-PRICE);
      expect((await api(app, token).delete(`/study-units/${unit.id}/members/${enrollment}`)).status).toBe(204);
      expect(await balanceOf(a!.id)).toBe(0);
      expect((await api(app, token).get(`/students/${a!.id}`)).body.data.status).toBe('new');

      // O'quvchi ro'yxatida va kartochkasida guruhi va kursi ko'rinadi; guruh va fan bo'yicha filtrlanadi
      expect((await api(app, token).get(`/students/${b!.id}`)).body.data.groups).toEqual([expect.objectContaining({ name: 'MEM-01', course: 'Ingliz tili', teacher: 'Teacher' })]);
      const inGroup = ((await api(app, token).get(`/students?filter[study_unit_id]=${unit.id}&limit=200`)).body.data as { full_name: string; groups: unknown[] }[]).map((s) => s.full_name).sort();
      expect(inGroup).toEqual(['Member B', 'Member C']);
      const byCourse = (await api(app, token).get(`/students?filter[discipline_id]=${discipline}&q=Member`)).body.data as { full_name: string }[];
      expect(byCourse.map((s) => s.full_name).sort()).toEqual(['Member B', 'Member C']);

      await api(app, token).patch(`/study-units/${unit.id}`, { status: 'paused' });
      expect((await api(app, token).get(`/students/${b!.id}`)).body.data.status).toBe('paused');
    });
  });

  describe('attendance and charges', () => {
    it('charges a monthly subscription regardless of attendance and never refunds it', async () => {
      const unit = (await newUnit('ATT-01', { classroom_id: undefined, schedule: everyDay('05:00', '05:45', -5, 5) })).body.data;
      const student = await newStudent('Charge Test');
      // 40 kun oldin boshlangan: 1-oy va boshlangan 2-oy uchun to'liq abonement
      await api(app, token).post(`/study-units/${unit.id}/members`, { student_id: student.id, start_date: iso(-40) });
      expect(await balanceOf(student.id)).toBe(-2 * PRICE);

      const lesson = await lessonOn(unit.id, iso(-1));
      const mark = (status: string, complete?: boolean) => api(app, token).put(`/lessons/${lesson.id}/attendance`, { entries: [{ student_id: student.id, status }], complete });
      // Kelsa ham, kelmasa ham, sababli bo'lsa ham — pul o'zgarmaydi
      for (const status of ['present', 'absent_unexcused', 'absent_excused', 'late']) {
        expect((await mark(status, true)).status).toBe(200);
        expect(await balanceOf(student.id)).toBe(-2 * PRICE);
      }
      expect((await lessonOn(unit.id, iso(-1))).status).toBe('completed');

      // Hisoblash ishi qayta-qayta ishlasa ham yechim ikkilanmaydi
      const subscriptions = app.get(SubscriptionService);
      await subscriptions.run();
      await subscriptions.run();
      expect(await balanceOf(student.id)).toBe(-2 * PRICE);
      // Bir oydan keyin navbatdagi oy boshlanadi → yana bitta yechim (boshqa testlardagi a'zoliklarga ta'sir qilmasligi uchun faqat shu a'zolik tekshiriladi)
      const ledger = (await api(app, token).get(`/students/${student.id}/ledger`)).body.data;
      expect(ledger.entries.map((e: { type: string; amount: number }) => [e.type, e.amount])).toEqual([['subscription', -PRICE], ['subscription', -PRICE]]);
      expect(ledger.entries[1].comment).toContain(`ATT-01: ${iso(-40)}`);

      // Dars bekor qilinsa ham, o'quvchi oy o'rtasida chiqsa ham pul qaytarilmaydi
      await api(app, token).post(`/lessons/${lesson.id}/cancel`, { reason: 'Texnik sabab' });
      expect(await balanceOf(student.id)).toBe(-2 * PRICE);
      expect((await mark('present')).body.error.code).toBe('LESSON_CANCELLED');
      const other = await lessonOn(unit.id, iso(-2));
      await api(app, token).put(`/lessons/${other.id}/attendance`, { entries: [{ student_id: student.id, status: 'present' }] });
      const enrollment = (await api(app, token).get(`/study-units/${unit.id}`)).body.data.members[0].enrollment_id;
      expect((await api(app, token).delete(`/study-units/${unit.id}/members/${enrollment}`)).status).toBe(204);
      expect(await balanceOf(student.id)).toBe(-2 * PRICE);
      expect((await api(app, token).get(`/study-units/${unit.id}`)).body.data.members[0].active).toBe(false);
    });

    it('does not charge in a paused group and charges when it becomes active', async () => {
      const unit = (await newUnit('ATT-03', { classroom_id: undefined })).body.data; // jadvalsiz → "shakllanmoqda"
      const student = await newStudent('Forming Student');
      await api(app, token).post(`/study-units/${unit.id}/members`, { student_id: student.id });
      expect(await balanceOf(student.id)).toBe(0);
      await api(app, token).put(`/study-units/${unit.id}/schedule`, everyDay('02:00', '02:30', 0, 5));
      expect(await balanceOf(student.id)).toBe(-PRICE);
    });

    it('rejects future lessons and students who are not enrolled that day', async () => {
      const unit = (await newUnit('ATT-02', { classroom_id: undefined, schedule: everyDay('04:00', '04:30', -5, 5) })).body.data;
      const [member, stranger] = await Promise.all([newStudent('Enrolled Late'), newStudent('Stranger')]);
      await api(app, token).post(`/study-units/${unit.id}/members`, { student_id: member!.id, start_date: iso(-1) });

      const future = await lessonOn(unit.id, iso(2));
      expect((await api(app, token).put(`/lessons/${future.id}/attendance`, { entries: [{ student_id: member!.id, status: 'present' }] })).body.error.code).toBe('LESSON_IN_FUTURE');
      const before = await lessonOn(unit.id, iso(-3));
      expect((await api(app, token).put(`/lessons/${before.id}/attendance`, { entries: [{ student_id: member!.id, status: 'present' }] })).status).toBe(400);
      const today = await lessonOn(unit.id, iso(0));
      expect((await api(app, token).put(`/lessons/${today.id}/attendance`, { entries: [{ student_id: stranger!.id, status: 'present' }] })).status).toBe(400);
      expect((await api(app, token).get(`/lessons/${today.id}/attendance`)).body.data.students).toEqual([expect.objectContaining({ full_name: 'Enrolled Late', status: null })]);

      const matrix = (await api(app, token).get(`/attendance/matrix?study_unit_id=${unit.id}&from=${iso(-3)}&to=${iso(0)}`)).body.data;
      expect(matrix.lessons).toHaveLength(4);
      // A'zolikdan oldingi kunlar 'na', keyingilari — belgilanmagan
      expect(matrix.rows[0].marks).toEqual(['na', 'na', null, null]);
    });
  });

  describe('payments and balances', () => {
    it('records payments, keeps the cached balance equal to the ledger sum and reports by student', async () => {
      const unit = (await newUnit('PAY-01', { classroom_id: undefined, schedule: everyDay('03:00', '03:30', -5, 5) })).body.data;
      const [payer, debtor, idle] = await Promise.all([newStudent('Payer One'), newStudent('Debtor One'), newStudent('Idle One')]);
      for (const s of [payer, debtor, idle]) await api(app, token).post(`/study-units/${unit.id}/members`, { student_id: s!.id, start_date: iso(-5) });
      // Har biriga qo'shilganda bir oylik abonement hisoblangan
      expect(await balanceOf(idle!.id)).toBe(-PRICE);

      const paid = await api(app, token).post('/payments', { student_id: payer!.id, amount: 3 * PRICE, method: 'cash', comment: 'Oktabr' });
      expect(paid.status).toBe(201);
      expect(paid.body.data.balance).toBe(2 * PRICE);
      expect((await api(app, token).post('/payments', { student_id: payer!.id, amount: -5, method: 'cash' })).status).toBe(400);
      expect((await api(app, token).post('/payments', { student_id: payer!.id, amount: PRICE, method: 'cash', date: iso(2) })).status).toBe(400);

      // Parallel to'lovlarda summa yo'qolmaydi
      await Promise.all(Array.from({ length: 6 }, () => api(app, token).post('/payments', { student_id: debtor!.id, amount: 100_000, method: 'payme' })));
      const sums = await owner.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${fx.tenantId}, true)`;
        return tx.$queryRaw<{ mismatched: number }[]>`
          SELECT count(*)::int AS mismatched FROM students s
          WHERE s.cached_balance <> COALESCE((SELECT sum(amount) FROM ledger_entries l WHERE l.student_id = s.id), 0)`;
      });
      expect(sums[0]?.mismatched).toBe(0);
      expect(await balanceOf(debtor!.id)).toBe(-PRICE + 600_000);

      const by = async (filter: string) => ((await api(app, token).get(`/finance/balances?filter=${filter}&q=One`)).body.data as { full_name: string }[]).map((r) => r.full_name).sort();
      expect(await by('all')).toEqual(['Debtor One', 'Idle One', 'Payer One']);
      expect(await by('debtors')).toEqual(['Debtor One', 'Idle One']);
      expect(await by('paid')).toEqual(['Debtor One', 'Payer One']);
      expect(await by('unpaid')).toEqual(['Idle One']);
      const row = ((await api(app, token).get('/finance/balances?filter=all&q=Payer')).body.data as { balance: number; months: number; groups: string[]; paid_this_month: number; next_payment_date: string }[])[0];
      expect(row).toMatchObject({ balance: 2 * PRICE, months: 2, monthly_price: PRICE, groups: ['PAY-01'], paid_this_month: 3 * PRICE });
      // 5 kun oldin boshlangan → keyingi abonement oyi taxminan 25 kundan keyin
      expect(row!.next_payment_date > iso(20) && row!.next_payment_date < iso(28)).toBe(true);

      const summary = (await api(app, token).get('/finance/summary')).body.data;
      expect(summary.today_revenue).toBeGreaterThanOrEqual(3 * PRICE + 600_000);
      expect(summary.month_revenue).toBeGreaterThanOrEqual(summary.today_revenue);
      expect(summary.debtors).toBeGreaterThanOrEqual(1);
      expect((await api(app, token).get('/payments')).body.data[0]).toMatchObject({ method: 'payme', created_by: 'Owner' });
    });

    it('reconciliation finds no mismatch between cached balances and the ledger', async () => {
      expect(await app.get(ReconciliationService).run()).toBe(0);
    });

    it('keeps the ledger append-only at the database level', async () => {
      const mutate = (client: PrismaClient, op: 'update' | 'delete') =>
        client.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_tenant', ${fx.tenantId}, true)`;
          return op === 'update' ? tx.ledgerEntry.updateMany({ data: { amount: 1n } }) : tx.ledgerEntry.deleteMany();
        });
      await expect(mutate(owner, 'update')).rejects.toThrow(/append-only/);
      await expect(mutate(owner, 'delete')).rejects.toThrow(/append-only/);
      await expect(mutate(appRole, 'delete')).rejects.toThrow(/permission denied/);
    });
  });

  describe('permissions and isolation', () => {
    it('limits teachers to their own groups and keeps finance away from sales', async () => {
      const mine = (await newUnit('PERM-MINE', { classroom_id: undefined })).body.data;
      const foreign = (await newUnit('PERM-OTHER', { classroom_id: undefined, teacher_id: fx.users.sales.id })).body.data;
      const teacher = await tokenFor(app, fx, 'teacher');
      const names = ((await api(app, teacher).get('/study-units?q=PERM-')).body.data as { name: string }[]).map((u) => u.name);
      expect(names).toEqual(['PERM-MINE']);
      expect((await api(app, teacher).get(`/study-units/${foreign.id}`)).status).toBe(404);
      expect((await api(app, teacher).get(`/study-units/${mine.id}`)).status).toBe(200);
      expect((await api(app, teacher).post('/study-units', { name: 'X' })).status).toBe(403);
      expect((await api(app, teacher).post('/payments', {})).status).toBe(403);

      const sales = await tokenFor(app, fx, 'sales');
      expect((await api(app, sales).post('/payments', { student_id: fx.users.owner.id, amount: 1000, method: 'cash' })).status).toBe(403);
      expect((await api(app, sales).get('/finance/summary')).status).toBe(403);

      const outsider = await tokenFor(app, other, 'owner');
      expect((await api(app, outsider).get(`/study-units/${mine.id}`)).status).toBe(404);
      expect((await api(app, outsider).get('/study-units')).body.data).toEqual([]);
      expect((await api(app, outsider).get(`/lessons?from=${iso(-5)}&to=${iso(5)}`)).body.data).toEqual([]);
    });
  });
});

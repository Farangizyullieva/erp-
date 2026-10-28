import { INestApplication } from '@nestjs/common';
import { api, createApp, createTenant, Fixture, login, nextPhone, owner, tokenFor } from './helpers';

const DAY = 86_400_000;
const iso = (offsetDays: number): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(Date.now() + offsetDays * DAY));
const PRICE = 5_000_000;

describe('student portal (e2e)', () => {
  let app: INestApplication;
  let fx: Fixture;
  let token: string;
  let unitId: string;

  const newStudent = async (name: string, phone: string | null = nextPhone()) => (await api(app, token).post('/students', { full_name: name, branch_id: fx.branches.a, phone })).body.data.id as string;
  /** Kabinetni yoqib, o'quvchi nomidan kirish tokenini oladi */
  const portalToken = async (studentId: string) => {
    const creds = (await api(app, token).post(`/students/${studentId}/portal`)).body.data as { login: string; password: string };
    const res = await login(app, fx, creds.login, creds.password);
    return { creds, token: res.body.data.access_token as string };
  };

  beforeAll(async () => {
    app = await createApp();
    fx = await createTenant();
    token = await tokenFor(app, fx, 'owner');
    const discipline = (await api(app, token).post('/dictionaries', { kind: 'discipline', name: 'Fizika' })).body.data.id;
    unitId = (
      await api(app, token).post('/study-units', { name: 'Kabinet guruhi', branch_id: fx.branches.a, discipline_id: discipline, teacher_id: fx.users.teacher.id, capacity: 10, price_amount: PRICE, schedule: { days: [1, 2, 3, 4, 5, 6, 7], start_time: '06:00', end_time: '07:00', period_start: iso(-3), period_end: iso(10) } })
    ).body.data.id;
  });

  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  it('gives a student a login that shows only their own data', async () => {
    const mine = await newStudent('Kabinet Egasi');
    const stranger = await newStudent('Begona Oquvchi');
    for (const s of [mine, stranger]) await api(app, token).post(`/study-units/${unitId}/members`, { student_id: s, start_date: iso(-3) });
    await api(app, token).post('/payments', { student_id: mine, amount: PRICE * 2, method: 'cash' });
    await api(app, token).post('/payments', { student_id: stranger, amount: 777_00, method: 'cash' });
    const lesson = ((await api(app, token).get(`/lessons?from=${iso(-1)}&to=${iso(-1)}&study_unit_id=${unitId}`)).body.data as { id: string }[])[0]!;
    await api(app, token).put(`/lessons/${lesson.id}/attendance`, { entries: [{ student_id: mine, status: 'present' }, { student_id: stranger, status: 'absent_unexcused' }] });

    const { token: st } = await portalToken(mine);
    const me = (await api(app, st).get('/portal/me')).body.data;
    expect(me.student.full_name).toBe('Kabinet Egasi');
    expect(me.balance).toBe(PRICE);
    expect(me.groups).toHaveLength(1);
    expect(me.groups[0]).toMatchObject({ name: 'Kabinet guruhi', teacher: 'Teacher', price_amount: PRICE });
    expect(me.attendance).toMatchObject({ marked: 1, attended: 1, rate: 100 });
    expect(me.upcoming.length).toBeGreaterThan(0);

    const lessons = (await api(app, st).get('/portal/lessons')).body.data.lessons as { date: string; mark: string | null }[];
    expect(lessons.find((l) => l.date === iso(-1))?.mark).toBe('present');
    const payments = (await api(app, st).get('/portal/payments')).body.data.entries as { type: string; amount: number }[];
    expect(payments.map((p) => [p.type, p.amount]).sort()).toEqual([['payment', PRICE * 2], ['subscription', -PRICE]].sort());

    // Kabinet foydalanuvchisi xodimlar uchun bironta endpointga kira olmaydi — hatto "faqat login" talab qiladiganlariga ham
    for (const path of ['/students', `/students/${stranger}`, `/students/${mine}`, '/finance/balances', '/payments', '/study-units', '/lessons?from=2026-10-01&to=2026-10-02', '/employees', '/employees/options', '/dictionaries', '/dashboard/summary', '/notifications', '/chats', '/leads', '/messaging/log']) {
      expect([path, (await api(app, st).get(path)).status]).toEqual([path, 403]);
    }
    expect((await api(app, st).post('/payments', { student_id: mine, amount: 100_000_00, method: 'cash' })).status).toBe(403);
    expect((await api(app, st).post(`/students/${stranger}/portal`)).status).toBe(403);
    expect((await api(app, st).get('/auth/me')).body.data.roles).toEqual(['student']);
  });

  it('hides portal accounts from the staff list and blocks staff from the portal', async () => {
    const s = await newStudent('Xodim Emas');
    await portalToken(s);
    const employees = (await api(app, token).get('/employees?limit=200')).body.data as { full_name: string }[];
    expect(employees.some((e) => e.full_name === 'Xodim Emas')).toBe(false);
    // Xodimning o'quvchi kabineti yo'q
    expect((await api(app, token).get('/portal/me')).status).toBe(403);
    expect((await api(app, await tokenFor(app, fx, 'teacher')).get('/portal/payments')).status).toBe(403);
  });

  it('lets the administrator set the password they choose', async () => {
    const s = await newStudent('Admin Paroli');
    // Administrator (reception) kabinet ocha oladi, lekin hamma narsaga ruxsati yo'q — masalan umumiy moliya va rollar
    const reception = await tokenFor(app, fx, 'admin');
    expect((await api(app, reception).get('/finance/summary')).status).toBe(403);
    expect((await api(app, reception).get('/roles')).status).toBe(403);
    const res = await api(app, reception).post(`/students/${s}/portal`, { password: 'bahor2026' });
    expect(res.body.data.password).toBe('bahor2026');
    expect((await login(app, fx, res.body.data.login, 'bahor2026')).status).toBe(200);
    expect((await api(app, token).post(`/students/${s}/portal`, { password: '123' })).status).toBe(400);
  });

  it('lets a student choose their own password', async () => {
    const s = await newStudent('Oz Paroli');
    const { creds, token: st } = await portalToken(s);
    expect((await api(app, st).post('/portal/password', { current_password: 'xato-parol', new_password: 'mening-parolim' })).status).toBe(400);
    expect((await api(app, st).post('/portal/password', { current_password: creds.password, new_password: '123' })).status).toBe(400);
    expect((await api(app, st).post('/portal/password', { current_password: creds.password, new_password: 'mening-parolim' })).status).toBe(204);
    expect((await login(app, fx, creds.login, creds.password)).status).toBe(401);
    expect((await login(app, fx, creds.login, 'mening-parolim')).status).toBe(200);
    // Xodim bu endpoint orqali o'z parolini o'zgartira olmaydi
    expect((await api(app, token).post('/portal/password', { current_password: 'x', new_password: 'yangi-parol' })).status).toBe(403);
  });

  it('resets the password, disables access and enforces preconditions', async () => {
    const s = await newStudent('Parol Yangilanadi');
    const first = await portalToken(s);
    const second = await portalToken(s);
    expect(second.creds.password).not.toBe(first.creds.password);
    // Eski parol va eski sessiya ishlamaydi
    expect((await login(app, fx, first.creds.login, first.creds.password)).status).toBe(401);
    expect((await api(app, token).get(`/students/${s}/portal`)).body.data).toMatchObject({ enabled: true, login: first.creds.login });

    expect((await api(app, token).delete(`/students/${s}/portal`)).status).toBe(204);
    expect((await api(app, second.token).get('/portal/me')).status).toBe(401);
    expect((await login(app, fx, second.creds.login, second.creds.password)).status).toBe(401);
    expect((await api(app, token).get(`/students/${s}/portal`)).body.data.enabled).toBe(false);

    // Telefonsiz o'quvchi; xodim telefoni bilan to'qnashuv; ruxsatsiz xodim; boshqa tashkilot
    expect((await api(app, token).post(`/students/${await newStudent('Telefonsiz', null)}/portal`)).status).toBe(409);
    expect((await api(app, token).post(`/students/${await newStudent('Xodim Raqami', fx.users.teacher.phone)}/portal`)).status).toBe(409);
    expect((await api(app, await tokenFor(app, fx, 'teacher')).post(`/students/${s}/portal`)).status).toBe(403);
    const other = await createTenant();
    expect((await api(app, await tokenFor(app, other, 'owner')).post(`/students/${s}/portal`)).status).toBe(404);
  });
});

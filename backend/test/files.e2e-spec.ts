import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { api, createApp, createTenant, Fixture, nextPhone, owner, tokenFor } from './helpers';

// Eng kichik haqiqiy PNG (1x1) va PNG deb yuborilgan skript
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const SCRIPT = Buffer.from('<?php system($_GET["c"]); ?>');
const iso = (offset: number): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(Date.now() + offset * 86_400_000));

describe('photos, attendance calendar and today feed (e2e)', () => {
  let app: INestApplication;
  let fx: Fixture;
  let other: Fixture;
  let token: string;

  const upload = (path: string, auth: string, content: Buffer, name = 'photo.png') => request(app.getHttpServer()).post(`/api/v1${path}`).set('Authorization', `Bearer ${auth}`).attach('file', content, name);
  const fetchUrl = (url: string) => request(app.getHttpServer()).get(url.replace(/^https?:\/\/[^/]+/, ''));

  beforeAll(async () => {
    app = await createApp();
    [fx, other] = await Promise.all([createTenant(), createTenant()]);
    token = await tokenFor(app, fx, 'owner');
  });

  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  it('stores a student photo and serves it only through a valid signed link', async () => {
    const student = (await api(app, token).post('/students', { full_name: 'Photo Test', branch_id: fx.branches.a, phone: nextPhone() })).body.data;
    expect(student.photo_url).toBeNull();

    const uploaded = await upload(`/students/${student.id}/photo`, token, PNG);
    expect(uploaded.status).toBe(201);
    const url = uploaded.body.data.photo_url as string;
    expect((await api(app, token).get(`/students/${student.id}`)).body.data.photo_url).toBe(url);
    expect((await api(app, token).get('/students?q=Photo')).body.data[0].photo_url).toBe(url);

    const served = await fetchUrl(url);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(served.body as Buffer, PNG)).toBe(0);

    // Imzo, muddat yoki tenant o'zgartirilsa — 404
    expect((await fetchUrl(url.replace(/sig=.{6}/, 'sig=AAAAAA'))).status).toBe(404);
    expect((await fetchUrl(url.replace(/exp=\d+/, 'exp=1000'))).status).toBe(404);
    expect((await fetchUrl(url.replace(/t=[0-9a-f-]+/, `t=${other.tenantId}`))).status).toBe(404);
    expect((await fetchUrl(url.replace(/\?.*/, ''))).status).toBe(400);

    // Yangi rasm eskisini almashtiradi; o'chirilgach havola ishlamaydi
    const second = (await upload(`/students/${student.id}/photo`, token, PNG)).body.data.photo_url as string;
    expect(second).not.toBe(url);
    expect((await fetchUrl(url)).status).toBe(404);
    expect((await api(app, token).delete(`/students/${student.id}/photo`)).status).toBe(204);
    expect((await fetchUrl(second)).status).toBe(404);
  });

  it('rejects disguised files, oversized files and unauthorised uploads', async () => {
    const student = (await api(app, token).post('/students', { full_name: 'Bad Upload', branch_id: fx.branches.a, phone: nextPhone() })).body.data;
    // PNG nomi va turi bilan yuborilgan skript — mazmuniga qarab rad etiladi
    const disguised = await upload(`/students/${student.id}/photo`, token, SCRIPT, 'avatar.png');
    expect(disguised.status).toBe(400);
    expect(disguised.body.error.details[0].code).toBe('UNSUPPORTED_TYPE');
    expect((await upload(`/students/${student.id}/photo`, token, Buffer.concat([PNG, Buffer.alloc(4 * 1024 * 1024)]))).status).toBe(413);
    expect((await request(app.getHttpServer()).post(`/api/v1/students/${student.id}/photo`).set('Authorization', `Bearer ${token}`)).status).toBe(400);

    expect((await upload(`/students/${student.id}/photo`, await tokenFor(app, fx, 'teacher'), PNG)).status).toBe(403);
    expect((await upload(`/students/${student.id}/photo`, await tokenFor(app, other, 'owner'), PNG)).status).toBe(404);
    expect((await upload(`/students/${student.id}/photo`, '', PNG)).status).toBe(401);
  });

  it('lets anyone set their own profile photo and managers set an employee photo', async () => {
    const teacher = await tokenFor(app, fx, 'teacher');
    const mine = await upload('/auth/me/photo', teacher, PNG);
    expect(mine.status).toBe(201);
    expect((await api(app, teacher).get('/auth/me')).body.data.photo_url).toBe(mine.body.data.photo_url);
    expect((await upload(`/employees/${fx.users.sales.id}/photo`, teacher, PNG)).status).toBe(403);
    expect((await upload(`/employees/${fx.users.sales.id}/photo`, token, PNG)).status).toBe(201);
    const sales = ((await api(app, token).get('/employees?q=Sales')).body.data as { photo_url: string | null }[])[0];
    expect(sales?.photo_url).toEqual(expect.stringContaining('/files/'));
  });

  it('builds the monthly attendance calendar and the dashboard feed for today', async () => {
    const discipline = (await api(app, token).post('/dictionaries', { kind: 'discipline', name: 'Kalendar fani' })).body.data.id;
    const unit = (await api(app, token).post('/study-units', {
      name: 'CAL-01', branch_id: fx.branches.a, discipline_id: discipline, teacher_id: fx.users.teacher.id, capacity: 5, price_amount: 1_000_000,
      schedule: { days: [1, 2, 3, 4, 5, 6, 7], start_time: '08:00', end_time: '09:00', period_start: iso(-3), period_end: iso(3) },
    })).body.data;
    const student = (await api(app, token).post('/students', { full_name: 'Calendar Kid', branch_id: fx.branches.a })).body.data;
    await api(app, token).post(`/study-units/${unit.id}/members`, { student_id: student.id, start_date: iso(-2) });
    const lessons = (await api(app, token).get(`/lessons?from=${iso(-2)}&to=${iso(0)}&study_unit_id=${unit.id}`)).body.data as { id: string; date: string }[];
    await api(app, token).put(`/lessons/${lessons[0]!.id}/attendance`, { entries: [{ student_id: student.id, status: 'present' }] });
    await api(app, token).put(`/lessons/${lessons[1]!.id}/attendance`, { entries: [{ student_id: student.id, status: 'absent_unexcused' }] });

    // Oy chegarasida test barqaror bo'lishi uchun ikkala oy ham yig'iladi
    const months = [...new Set([iso(-3).slice(0, 7), iso(3).slice(0, 7)])];
    const days = (await Promise.all(months.map((m) => api(app, token).get(`/students/${student.id}/attendance?month=${m}`)))).flatMap((r) => r.body.data.days as { date: string; status: string | null; group: string }[]);
    // A'zolikdan oldingi dars (−3 kun) kalendarga kirmaydi; kelajakdagilar belgilanmagan holda ko'rinadi
    expect(days.map((d) => d.date)).toEqual([iso(-2), iso(-1), iso(0), iso(1), iso(2), iso(3)]);
    expect(days.slice(0, 3).map((d) => d.status)).toEqual(['present', 'absent_unexcused', null]);
    expect(days[0]?.group).toBe('CAL-01');
    const current = (await api(app, token).get(`/students/${student.id}/attendance`)).body.data;
    expect(current.month).toBe(iso(0).slice(0, 7));
    expect((await api(app, await tokenFor(app, other, 'owner')).get(`/students/${student.id}/attendance`)).status).toBe(404);

    const feed = (await api(app, token).get('/dashboard/summary')).body.data.today as { group: string; students: number; marked: number; teacher: string }[];
    expect(feed.find((l) => l.group === 'CAL-01')).toMatchObject({ students: 1, marked: 0, teacher: 'Teacher' });
    // O'qituvchi lentada faqat o'z darslarini ko'radi
    const sales = (await api(app, await tokenFor(app, fx, 'sales')).get('/dashboard/summary')).body.data.today as { group: string }[];
    expect(sales.map((l) => l.group)).toContain('CAL-01');
  });
});

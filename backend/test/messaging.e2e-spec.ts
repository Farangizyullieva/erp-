import { INestApplication } from '@nestjs/common';
import { MessagingWorker } from '../src/modules/messaging/messaging.worker';
import { MESSENGER, MessengerError, MessengerProvider } from '../src/modules/messaging/messenger.provider';
import { api, createApp, createTenant, Fixture, nextPhone, owner, tokenFor } from './helpers';

/** Soxta Telegram: yuborilgan xabarlarni eslab qoladi, kerak bo'lsa xato qaytaradi */
class FakeMessenger implements MessengerProvider {
  sent: { chatId: string; text: string }[] = [];
  failWith: MessengerError | null = null;
  username = async () => 'educrm_test_bot';
  poll = async () => [];
  async send(chatId: string, text: string): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.sent.push({ chatId, text });
  }
}

// Toshkent vaqti bilan: seshanba 12:00 (oyna ichida), seshanba 23:30 (oynadan tashqari), yakshanba 18:30
// Sanalar doim kelajakda bo'lishi kerak (navbatdagi xabar "hozir"dan keyin yetiladi) — shuning uchun ertadan hisoblanadi
const TOMORROW = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const NOON = new Date(`${TOMORROW}T07:00:00Z`);
const NIGHT = new Date(`${TOMORROW}T18:30:00Z`);
const SUNDAY_EVENING = (() => {
  const d = new Date(`${TOMORROW}T13:30:00Z`);
  while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1);
  return d;
})();

describe('telegram messaging (e2e)', () => {
  let app: INestApplication;
  let fx: Fixture;
  let other: Fixture;
  let token: string;
  let worker: MessagingWorker;
  const fake = new FakeMessenger();

  const newStudent = async (name = 'Karimov Aziz') => {
    const res = await api(app, token).post('/students', { full_name: name, branch_id: fx.branches.a, contact: { full_name: 'Karimova Dilnoza', relation: 'Ona', phone: nextPhone() } });
    return { id: res.body.data.id as string, contactId: res.body.data.contacts[0].id as string };
  };
  const link = async (studentId: string, contactId: string, chatId: string) => {
    const res = await api(app, token).post(`/students/${studentId}/contacts/${contactId}/telegram-link`);
    const start = new URL(res.body.data.url as string).searchParams.get('start') as string;
    await worker.receive(chatId, `/start ${start}`);
    return start;
  };

  beforeAll(async () => {
    app = await createApp((builder) => builder.overrideProvider(MESSENGER).useValue(fake));
    [fx, other] = await Promise.all([createTenant(), createTenant()]);
    token = await tokenFor(app, fx, 'owner');
    worker = app.get(MessagingWorker);
  });

  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  beforeEach(() => {
    fake.sent = [];
    fake.failWith = null;
  });

  it('links a parent through a one-time deep link', async () => {
    const s = await newStudent();
    const created = await api(app, token).post(`/students/${s.id}/contacts/${s.contactId}/telegram-link`);
    expect(created.status).toBe(200);
    expect(created.body.data.url).toMatch(/^https:\/\/t\.me\/educrm_test_bot\?start=[0-9a-f]{32}_[\w-]+$/);
    const start = new URL(created.body.data.url as string).searchParams.get('start') as string;
    expect(start.length).toBeLessThanOrEqual(64); // Telegram start parametri cheklovi

    expect((await api(app, token).get(`/students/${s.id}`)).body.data.contacts[0].telegram_linked).toBe(false);
    await worker.receive('1001', `/start ${start}`);
    expect(fake.sent.at(-1)).toMatchObject({ chatId: '1001', text: expect.stringContaining('Karimov Aziz') });
    expect((await api(app, token).get(`/students/${s.id}`)).body.data.contacts[0].telegram_linked).toBe(true);

    // Havola bir martalik: boshqa odam shu havola bilan ulana olmaydi
    await worker.receive('6666', `/start ${start}`);
    expect(fake.sent.at(-1)?.text).toContain('yaroqsiz');
    await worker.receive('6666', '/start not-a-token');
    await worker.receive('6666', 'salom');
    expect(fake.sent.at(-1)?.text).toContain('Assalomu alaykum');
    expect((await api(app, token).get('/messaging/status')).body.data).toMatchObject({ configured: true, connected: true, bot_username: 'educrm_test_bot', linked_contacts: 1 });
  });

  it('queues a manual message and delivers it through the worker', async () => {
    const s = await newStudent('Valiyev Sardor');
    const noRecipients = await api(app, token).post(`/students/${s.id}/messages`, { text: 'Salom' });
    expect(noRecipients.status).toBe(409);
    expect(noRecipients.body.error.code).toBe('NO_RECIPIENTS');

    await link(s.id, s.contactId, '2002');
    fake.sent = [];
    const queued = await api(app, token).post(`/students/${s.id}/messages`, { text: '  Ertaga dars 15:00 da boshlanadi  ' });
    expect(queued.body.data).toEqual({ queued: 1 });
    // So'rov ichida hech narsa yuborilmaydi — faqat navbatga yoziladi
    expect(fake.sent).toEqual([]);

    // Tunda yuborilmaydi (yuborish oynasi), kunduzi ketadi
    expect(await worker.sendDue(NIGHT)).toBe(0);
    expect(fake.sent).toEqual([]);
    expect(await worker.sendDue(new Date(NIGHT.getTime() + 13 * 3_600_000))).toBe(1);
    expect(fake.sent).toEqual([{ chatId: '2002', text: 'Ertaga dars 15:00 da boshlanadi' }]);
    // Ikkinchi marta yuborilmaydi
    expect(await worker.sendDue(new Date(NIGHT.getTime() + 14 * 3_600_000))).toBe(0);

    const log = (await api(app, token).get('/messaging/log')).body.data;
    expect(log[0]).toMatchObject({ kind: 'manual', status: 'sent', recipient: 'Karimova Dilnoza', student: { full_name: 'Valiyev Sardor' } });
  });

  it('retries temporary failures and stops on a blocked bot', async () => {
    const s = await newStudent('Retry Test');
    await link(s.id, s.contactId, '3003');
    await api(app, token).post(`/students/${s.id}/messages`, { text: 'retry' });

    fake.failWith = new MessengerError('Too Many Requests', false);
    expect(await worker.sendDue(NOON)).toBe(0);
    let entry = (await api(app, token).get('/messaging/log')).body.data[0];
    expect(entry).toMatchObject({ status: 'queued', error: 'Too Many Requests' });
    // Backoff: darhol qayta urinilmaydi
    fake.failWith = null;
    expect(await worker.sendDue(new Date(NOON.getTime() + 30_000))).toBe(0);
    expect(await worker.sendDue(new Date(NOON.getTime() + 5 * 60_000))).toBe(1);

    await api(app, token).post(`/students/${s.id}/messages`, { text: 'blocked' });
    fake.failWith = new MessengerError('Forbidden: bot was blocked by the user', true, true);
    await worker.sendDue(new Date(NOON.getTime() + 10 * 60_000));
    entry = (await api(app, token).get('/messaging/log')).body.data[0];
    expect(entry.status).toBe('failed');
    // Bloklagan oluvchi ulanmagan hisoblanadi — keyingi xabarlar unga qo'yilmaydi
    expect((await api(app, token).get(`/students/${s.id}`)).body.data.contacts[0].telegram_linked).toBe(false);
    expect((await api(app, token).post(`/students/${s.id}/messages`, { text: 'again' })).status).toBe(409);
  });

  it('sends the weekly report once per week when enabled', async () => {
    const s = await newStudent('Haftalik Test');
    await link(s.id, s.contactId, '4004');
    fake.sent = [];

    const preview = await api(app, token).get(`/students/${s.id}/weekly-report`);
    expect(preview.body.data.text).toContain('Haftalik hisobot — Haftalik Test');
    expect(preview.body.data.text).toContain("Qarzdorlik yo'q");

    // Sozlamada o'chiq bo'lsa yuborilmaydi
    await worker.weeklyCheck(SUNDAY_EVENING);
    await worker.sendDue(SUNDAY_EVENING);
    expect(fake.sent.filter((m) => m.chatId === '4004')).toEqual([]);

    expect((await api(app, await tokenFor(app, fx, 'sales')).put('/messaging/weekly-report', { enabled: true })).status).toBe(403);
    expect((await api(app, token).put('/messaging/weekly-report', { enabled: true })).body.data).toEqual({ weekly_report_enabled: true });
    // Yakshanba 18:00 dan oldin emas
    await worker.weeklyCheck(new Date(SUNDAY_EVENING.getTime() - 3 * 3_600_000));
    await worker.weeklyCheck(NOON);
    await worker.sendDue(SUNDAY_EVENING);
    expect(fake.sent.filter((m) => m.chatId === '4004')).toEqual([]);

    await worker.weeklyCheck(SUNDAY_EVENING);
    await worker.weeklyCheck(new Date(SUNDAY_EVENING.getTime() + 10 * 60_000)); // shu haftada takrorlanmaydi
    await worker.sendDue(SUNDAY_EVENING);
    const mine = fake.sent.filter((m) => m.chatId === '4004');
    expect(mine).toHaveLength(1);
    expect(mine[0]?.text).toContain('Haftalik hisobot — Haftalik Test');
  });

  it('enforces permissions, scoping and tenant isolation', async () => {
    const s = await newStudent('Scope Test');
    const teacher = await tokenFor(app, fx, 'teacher');
    expect((await api(app, teacher).post(`/students/${s.id}/messages`, { text: 'x' })).status).toBe(403);
    expect((await api(app, teacher).post(`/students/${s.id}/contacts/${s.contactId}/telegram-link`)).status).toBe(403);
    expect((await api(app, teacher).get('/messaging/log')).status).toBe(403);

    const foreign = await tokenFor(app, other, 'owner');
    expect((await api(app, foreign).post(`/students/${s.id}/messages`, { text: 'x' })).status).toBe(404);
    expect((await api(app, foreign).post(`/students/${s.id}/contacts/${s.contactId}/telegram-link`)).status).toBe(404);
    expect((await api(app, foreign).get('/messaging/log')).body.data).toEqual([]);
    expect((await api(app, token).post(`/students/${s.id}/messages`, { text: '' })).status).toBe(400);
  });

  it('reports a clear error when the bot is not configured', async () => {
    const plain = await createApp();
    const t = await tokenFor(plain, fx, 'owner');
    const s = await newStudent('No Bot');
    expect((await api(plain, t).get('/messaging/status')).body.data).toMatchObject({ configured: false, connected: false, bot_username: null });
    const res = await api(plain, t).post(`/students/${s.id}/contacts/${s.contactId}/telegram-link`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TELEGRAM_NOT_CONFIGURED');
    await plain.close();
  });
});

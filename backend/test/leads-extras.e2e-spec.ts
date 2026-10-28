import { INestApplication } from '@nestjs/common';
import { MessagingWorker } from '../src/modules/messaging/messaging.worker';
import { MESSENGER, MessengerProvider } from '../src/modules/messaging/messenger.provider';
import { api, createApp, createTenant, Fixture, nextPhone, owner, tokenFor } from './helpers';

class FakeMessenger implements MessengerProvider {
  sent: { chatId: string; text: string }[] = [];
  username = async () => 'educrm_test_bot';
  poll = async () => [];
  async send(chatId: string, text: string): Promise<void> {
    this.sent.push({ chatId, text });
  }
}

const DAY = 86_400_000;
const iso = (offsetDays: number): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(Date.now() + offsetDays * DAY));
const PRICE = 5_000_000;

describe('group numbers, attendance overview, leads and debt reminders (e2e)', () => {
  let app: INestApplication;
  let fx: Fixture;
  let other: Fixture;
  let token: string;
  let otherToken: string;
  let discipline: string;
  const fake = new FakeMessenger();

  const newUnit = (name: string, extra: object = {}) =>
    api(app, token).post('/study-units', { name, branch_id: fx.branches.a, discipline_id: discipline, teacher_id: fx.users.teacher.id, capacity: 10, price_amount: PRICE, ...extra });

  beforeAll(async () => {
    app = await createApp((builder) => builder.overrideProvider(MESSENGER).useValue(fake));
    [fx, other] = await Promise.all([createTenant(), createTenant()]);
    token = await tokenFor(app, fx, 'owner');
    otherToken = await tokenFor(app, other, 'owner');
    discipline = (await api(app, token).post('/dictionaries', { kind: 'discipline', name: 'Backend' })).body.data.id;
  });

  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  describe('group numbers', () => {
    it('numbers groups sequentially per tenant and finds them by number', async () => {
      const first = (await newUnit('Node kechki')).body.data;
      const second = (await newUnit('Python ertalabki')).body.data;
      expect(second.number).toBe(first.number + 1);
      // Boshqa tashkilotning sanog'i alohida
      const otherDiscipline = (await api(app, otherToken).post('/dictionaries', { kind: 'discipline', name: 'Backend' })).body.data.id;
      const foreign = await api(app, otherToken).post('/study-units', { name: 'Begona', branch_id: other.branches.a, discipline_id: otherDiscipline, teacher_id: other.users.teacher.id, capacity: 5, price_amount: PRICE });
      expect(foreign.body.data.number).toBe(1);

      const found = async (q: string) => ((await api(app, token).get(`/study-units?q=${encodeURIComponent(q)}`)).body.data as { id: string }[]).map((u) => u.id);
      expect(await found(String(second.number))).toEqual([second.id]);
      expect(await found(`#${second.number}`)).toEqual([second.id]);
      // "2 backend": raqam + fan nomi
      expect(await found(`${second.number} backend`)).toEqual([second.id]);
      expect(await found(`${second.number} ingliz`)).toEqual([]);
      // Fan nomi bo'yicha ikkalasi ham chiqadi
      expect((await found('backend')).sort()).toEqual([first.id, second.id].sort());
    });
  });

  describe('attendance overview', () => {
    it('summarises every student across groups for the period', async () => {
      const unit = (await newUnit('Davomat guruhi', { schedule: { days: [1, 2, 3, 4, 5, 6, 7], start_time: '06:00', end_time: '07:00', period_start: iso(-3), period_end: iso(3) } })).body.data;
      const students: string[] = [];
      for (const name of ['Aliyev Bobur', 'Saidova Malika']) {
        const s = (await api(app, token).post('/students', { full_name: name, branch_id: fx.branches.a, phone: nextPhone() })).body.data.id as string;
        await api(app, token).post(`/study-units/${unit.id}/members`, { student_id: s, start_date: iso(-3) });
        students.push(s);
      }
      const lessons = (await api(app, token).get(`/lessons?from=${iso(-2)}&to=${iso(-1)}&study_unit_id=${unit.id}`)).body.data as { id: string; branch: { id: string } }[];
      expect(lessons).toHaveLength(2);
      expect(lessons[0]?.branch.id).toBe(fx.branches.a);
      await api(app, token).put(`/lessons/${lessons[0]?.id}/attendance`, { entries: [{ student_id: students[0], status: 'present' }, { student_id: students[1], status: 'absent_unexcused' }] });
      await api(app, token).put(`/lessons/${lessons[1]?.id}/attendance`, { entries: [{ student_id: students[0], status: 'late' }, { student_id: students[1], status: 'present' }] });

      const res = await api(app, token).get(`/attendance/overview?from=${iso(-3)}&to=${iso(0)}&study_unit_id=${unit.id}`);
      expect(res.status).toBe(200);
      const rows = res.body.data.rows as { id: string; present: number; late: number; absent_unexcused: number; rate: number; groups: { number: number }[] }[];
      // Eng past davomat tepada
      expect(rows.map((r) => r.id)).toEqual([students[1], students[0]]);
      expect(rows[0]).toMatchObject({ present: 1, absent_unexcused: 1, rate: 50 });
      expect(rows[1]).toMatchObject({ present: 1, late: 1, rate: 100 });
      expect(rows[0]?.groups[0]?.number).toBe(unit.number);
      expect(res.body.data.summary).toMatchObject({ students: 2, marked: 4, absent: 1, rate: 75, at_risk: 1 });

      // Boshqa tashkilot hech narsa ko'rmaydi
      expect((await api(app, otherToken).get(`/attendance/overview?from=${iso(-3)}&to=${iso(0)}`)).body.data.rows).toEqual([]);
    });
  });

  describe('leads', () => {
    it('moves a lead through the funnel and converts it into a student', async () => {
      const created = await api(app, token).post('/leads', { full_name: 'Tursunov Jasur', branch_id: fx.branches.a, phone: '90 123 45 67', discipline_id: discipline });
      expect(created.status).toBe(201);
      const id = created.body.data.id as string;
      expect(created.body.data).toMatchObject({ stage: 'new', phone: '+998901234567', owner: { id: fx.users.owner.id } });

      expect((await api(app, token).patch(`/leads/${id}`, { stage: 'trial' })).body.data.stage).toBe('trial');
      // Rad etish sababsiz bo'lmaydi; "o'quvchi bo'ldi" bosqichi qo'lda qo'yilmaydi
      expect((await api(app, token).patch(`/leads/${id}`, { stage: 'lost' })).status).toBe(400);
      expect((await api(app, token).patch(`/leads/${id}`, { stage: 'enrolled' })).status).toBe(400);
      await api(app, token).post(`/leads/${id}/notes`, { text: "Sinov darsiga keldi, yoqdi" });

      const converted = await api(app, token).post(`/leads/${id}/convert`);
      expect(converted.status).toBe(200);
      const student = await api(app, token).get(`/students/${converted.body.data.student_id}`);
      expect(student.body.data).toMatchObject({ full_name: 'Tursunov Jasur', phone: '+998901234567' });

      const detail = (await api(app, token).get(`/leads/${id}`)).body.data;
      expect(detail.stage).toBe('enrolled');
      expect((detail.events as { type: string }[]).map((e) => e.type)).toEqual(['converted', 'note', 'stage', 'created']);
      // Ikkinchi marta aylantirib bo'lmaydi, o'zgartirib ham
      expect((await api(app, token).post(`/leads/${id}/convert`)).status).toBe(409);
      expect((await api(app, token).patch(`/leads/${id}`, { stage: 'new' })).status).toBe(409);
    });

    it('isolates leads between tenants and respects roles', async () => {
      const id = (await api(app, token).post('/leads', { full_name: 'Maxfiy Lid', branch_id: fx.branches.a })).body.data.id as string;
      expect((await api(app, otherToken).get(`/leads/${id}`)).status).toBe(404);
      expect((await api(app, otherToken).patch(`/leads/${id}`, { stage: 'contacted' })).status).toBe(404);
      expect(((await api(app, otherToken).get('/leads')).body.data as unknown[]).length).toBe(0);
      // Boshqa tashkilot filialiga lid qo'shib bo'lmaydi
      expect((await api(app, otherToken).post('/leads', { full_name: 'Begona', branch_id: fx.branches.a })).status).toBe(400);
      // O'qituvchida lid ruxsati yo'q
      const teacher = await tokenFor(app, fx, 'teacher');
      expect((await api(app, teacher).get('/leads')).status).toBe(403);
      expect((await api(app, teacher).post(`/leads/${id}/convert`)).status).toBe(403);
      // Sotuv menejeri o'chira olmaydi (lead.delete yo'q)
      const sales = await tokenFor(app, fx, 'sales');
      expect((await api(app, sales).delete(`/leads/${id}`)).status).toBe(403);
      expect((await api(app, token).delete(`/leads/${id}`)).status).toBe(204);
    });
  });

  describe('debt reminders', () => {
    it('queues one reminder per linked debtor and does not repeat within a day', async () => {
      const worker = app.get(MessagingWorker);
      const unit = (await newUnit('Qarz guruhi', { schedule: { days: [1, 2, 3, 4, 5, 6, 7], start_time: '08:00', end_time: '09:00', period_start: iso(-1), period_end: iso(5) } })).body.data;
      const make = async (name: string) => {
        const res = await api(app, token).post('/students', { full_name: name, branch_id: fx.branches.a, contact: { full_name: `${name} onasi`, relation: 'Ona', phone: nextPhone() } });
        await api(app, token).post(`/study-units/${unit.id}/members`, { student_id: res.body.data.id });
        return { id: res.body.data.id as string, contactId: res.body.data.contacts[0].id as string };
      };
      const linked = await make('Qarzdor Ulangan');
      const unlinked = await make('Qarzdor Ulanmagan');
      const paid = await make('Tolagan Oquvchi');
      await api(app, token).post('/payments', { student_id: paid.id, amount: PRICE, method: 'cash' });
      for (const [s, chat] of [[linked, '7001'], [paid, '7002']] as const) {
        const url = (await api(app, token).post(`/students/${s.id}/contacts/${s.contactId}/telegram-link`)).body.data.url as string;
        await worker.receive(chat, `/start ${new URL(url).searchParams.get('start')}`);
      }
      const ids = [linked.id, unlinked.id, paid.id];

      const preview = await api(app, token).post('/messaging/debt-reminders', { student_ids: ids, dry_run: true });
      expect(preview.body.data).toMatchObject({ debtors: 2, will_receive: 1, not_linked: 1, queued: 0, total_debt: PRICE * 2 });

      const sent = await api(app, token).post('/messaging/debt-reminders', { student_ids: ids });
      expect(sent.body.data).toMatchObject({ queued: 1, will_receive: 1 });
      fake.sent = [];
      await worker.sendDue(new Date(`${iso(1)}T07:00:00Z`)); // ertaga tush payti (Toshkent)
      expect(fake.sent).toHaveLength(1);
      expect(fake.sent[0]).toMatchObject({ chatId: '7001' });
      expect(fake.sent[0]?.text).toContain('Qarzdor Ulangan');
      expect(fake.sent[0]?.text).toContain('50 000');

      // 24 soat ichida qayta yuborilmaydi
      const again = await api(app, token).post('/messaging/debt-reminders', { student_ids: ids });
      expect(again.body.data).toMatchObject({ queued: 0, recently_reminded: 1 });

      // Balans ro'yxatida Telegram belgisi
      const balances = (await api(app, token).get('/finance/balances?filter=debtors')).body.data as { id: string; telegram_linked: boolean }[];
      expect(balances.find((b) => b.id === linked.id)?.telegram_linked).toBe(true);
      expect(balances.find((b) => b.id === unlinked.id)?.telegram_linked).toBe(false);

      // Ommaviy yuborish ruxsati yo'q xodim yubora olmaydi; boshqa tashkilot bu o'quvchilarni ko'rmaydi
      expect((await api(app, await tokenFor(app, fx, 'sales')).post('/messaging/debt-reminders', { student_ids: ids })).status).toBe(403);
      expect((await api(app, otherToken).post('/messaging/debt-reminders', { student_ids: ids, dry_run: true })).body.data.debtors).toBe(0);
    });
  });
});

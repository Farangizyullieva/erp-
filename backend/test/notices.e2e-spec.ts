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
/** Ertaga tush payti (Toshkent): kechiktirilgan xabarlar ham yetilgan, yuborish oynasi ichida */
const LATER = new Date(`${iso(1)}T07:00:00Z`);

describe('automatic notices and receipts (e2e)', () => {
  let app: INestApplication;
  let fx: Fixture;
  let token: string;
  let worker: MessagingWorker;
  let discipline: string;
  let chatSeq = 9000;
  const fake = new FakeMessenger();

  const newUnit = async (name: string, from: number, start = '06:00', end = '07:00') =>
    (await api(app, token).post('/study-units', { name, branch_id: fx.branches.a, discipline_id: discipline, teacher_id: fx.users.teacher.id, capacity: 10, price_amount: PRICE, schedule: { days: [1, 2, 3, 4, 5, 6, 7], start_time: start, end_time: end, period_start: iso(from), period_end: iso(10) } })).body.data as { id: string };
  /** Ota-onasi botga ulangan o'quvchi */
  const linkedStudent = async (name: string) => {
    const res = await api(app, token).post('/students', { full_name: name, branch_id: fx.branches.a, contact: { full_name: `${name} onasi`, relation: 'Ona', phone: nextPhone() } });
    const id = res.body.data.id as string;
    const chat = String(chatSeq++);
    const url = (await api(app, token).post(`/students/${id}/contacts/${res.body.data.contacts[0].id}/telegram-link`)).body.data.url as string;
    await worker.receive(chat, `/start ${new URL(url).searchParams.get('start')}`);
    fake.sent = [];
    return { id, chat };
  };
  const logOf = async (kind: string) => ((await api(app, token).get('/messaging/log')).body.data as { kind: string; status: string; body: string; student: { id: string } }[]).filter((m) => m.kind === kind);

  beforeAll(async () => {
    app = await createApp((builder) => builder.overrideProvider(MESSENGER).useValue(fake));
    fx = await createTenant();
    token = await tokenFor(app, fx, 'owner');
    worker = app.get(MessagingWorker);
    discipline = (await api(app, token).post('/dictionaries', { kind: 'discipline', name: 'Matematika' })).body.data.id;
  });

  afterAll(async () => {
    // Navbatda qolgan xabarlar boshqa test to'plamlariga o'tib ketmasin
    await worker.sendDue(LATER);
    await app.close();
    await owner.$disconnect();
  });

  beforeEach(() => {
    fake.sent = [];
  });

  it('sends a Telegram receipt and exposes a printable one', async () => {
    const s = await linkedStudent('Chek Oquvchi');
    const paid = await api(app, token).post('/payments', { student_id: s.id, amount: PRICE, method: 'card' });
    expect(paid.body.data).toMatchObject({ receipt_number: '000001', receipt_sent: true });
    await worker.sendDue(LATER);
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]?.text).toContain('Chek №000001');
    expect(fake.sent[0]?.text).toContain('50 000');

    const receipt = await api(app, token).get(`/payments/${paid.body.data.id}/receipt`);
    expect(receipt.body.data).toMatchObject({ number: '000001', amount: PRICE, method: 'card', student: { full_name: 'Chek Oquvchi' }, cashier: 'Owner' });
    // Raqam ketma-ket; sozlamada o'chirilsa Telegram chek ketmaydi
    await api(app, token).put('/messaging/settings', { receipt_enabled: false });
    const second = await api(app, token).post('/payments', { student_id: s.id, amount: PRICE, method: 'cash' });
    expect(second.body.data).toMatchObject({ receipt_number: '000002', receipt_sent: false });
    // Boshqa tashkilot chekni ko'rmaydi
    const other = await createTenant();
    expect((await api(app, await tokenFor(app, other, 'owner')).get(`/payments/${paid.body.data.id}/receipt`)).status).toBe(404);
  });

  it('cancels a wrong payment with a reversal instead of editing the ledger', async () => {
    const s = (await api(app, token).post('/students', { full_name: 'Xato Tolov', branch_id: fx.branches.a, phone: nextPhone() })).body.data.id as string;
    const before = (await api(app, token).get('/finance/summary')).body.data as { month_revenue: number; month_payments: number };
    const paid = (await api(app, token).post('/payments', { student_id: s, amount: PRICE * 10, method: 'cash' })).body.data as { id: string };
    expect((await api(app, token).post(`/payments/${paid.id}/cancel`, {})).status).toBe(400); // sabab majburiy
    const cancelled = await api(app, token).post(`/payments/${paid.id}/cancel`, { reason: "Summa xato kiritildi" });
    expect(cancelled.body.data.balance).toBe(0);
    expect((await api(app, token).post(`/payments/${paid.id}/cancel`, { reason: 'yana' })).status).toBe(409);
    // Ro'yxat va tushum hisobidan chiqadi, shaxsiy hisobda izi qoladi
    expect(((await api(app, token).get('/payments')).body.data as { id: string }[]).some((p) => p.id === paid.id)).toBe(false);
    expect((await api(app, token).get('/finance/summary')).body.data).toMatchObject(before);
    const ledger = (await api(app, token).get(`/students/${s}/ledger`)).body.data.entries as { type: string; cancelled: boolean; amount: number }[];
    expect(ledger.map((e) => [e.type, e.cancelled, e.amount]).sort()).toEqual([['payment', true, PRICE * 10], ['payment_cancel', false, -PRICE * 10]].sort());
    // Sotuv menejerida to'lovni bekor qilish ruxsati yo'q
    expect((await api(app, await tokenFor(app, fx, 'sales')).post(`/payments/${paid.id}/cancel`, { reason: 'test' })).status).toBe(403);
  });

  it('notifies parents about an unexcused absence today, once, and cancels it when corrected', async () => {
    const unit = await newUnit('Kelmaganlar guruhi', -1);
    const s = await linkedStudent('Kelmagan Bola');
    await api(app, token).post(`/study-units/${unit.id}/members`, { student_id: s.id, start_date: iso(-1) });
    const lessons = (await api(app, token).get(`/lessons?from=${iso(-1)}&to=${iso(0)}&study_unit_id=${unit.id}`)).body.data as { id: string; date: string }[];
    const today = lessons.find((l) => l.date === iso(0))!;
    const yesterday = lessons.find((l) => l.date === iso(-1))!;
    const mark = (lessonId: string, status: string) => api(app, token).put(`/lessons/${lessonId}/attendance`, { entries: [{ student_id: s.id, status }] });

    // Kechagi dars uchun xabar ketmaydi; sababli kelmaganlik uchun ham
    expect((await mark(yesterday.id, 'absent_unexcused')).body.data.parents_notified).toBe(0);
    expect((await mark(today.id, 'absent_excused')).body.data.parents_notified).toBe(0);

    expect((await mark(today.id, 'absent_unexcused')).body.data.parents_notified).toBe(1);
    // Darhol ketmaydi: tuzatishga vaqt beriladi
    await worker.sendDue(new Date());
    expect(fake.sent).toHaveLength(0);
    // Xato belgilangan ekan → tuzatildi → xabar bekor bo'ladi
    await mark(today.id, 'present');
    expect(await logOf('absence')).toHaveLength(0);

    await mark(today.id, 'absent_unexcused');
    await mark(today.id, 'absent_unexcused'); // qayta saqlash takror xabar yaratmaydi
    expect(await logOf('absence')).toHaveLength(1);
    await worker.sendDue(LATER);
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]?.text).toContain('Kelmagan Bola bugun darsga kelmadi');
    expect(fake.sent[0]?.text).toContain('06:00');
  });

  it('reminds 3 days before the next subscription month unless the balance covers it', async () => {
    // A'zolik shunday sanadan boshlanadiki, keyingi oy roppa-rosa 3 kundan keyin boshlanadi
    const target = new Date(`${iso(3)}T00:00:00Z`);
    const start = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() - 1, target.getUTCDate()));
    if (start.getUTCDate() !== target.getUTCDate()) return; // oy oxiri (29–31): sana oldingi oyda yo'q
    const startIso = start.toISOString().slice(0, 10);
    const unit = await newUnit('Eslatma guruhi', -40, '08:00', '09:00');
    const debtor = await linkedStudent('Tolamagan Bola');
    const prepaid = await linkedStudent('Oldindan Tolagan');
    for (const s of [debtor, prepaid]) await api(app, token).post(`/study-units/${unit.id}/members`, { student_id: s.id, start_date: startIso });
    await api(app, token).post('/payments', { student_id: prepaid.id, amount: PRICE * 2, method: 'cash' });

    const noon = new Date(`${iso(0)}T07:00:00Z`);
    expect(await worker.dailyCheck(new Date(`${iso(0)}T03:00:00Z`))).toBe(0); // 08:00 — hali erta
    await worker.dailyCheck(noon);
    const reminders = await logOf('payment_reminder');
    expect(reminders.map((r) => r.student.id)).toEqual([debtor.id]);
    expect(reminders[0]?.body).toContain('Eslatma guruhi');
    expect(reminders[0]?.body).toContain('Qarzdorlik: 50 000');
    // Shu kuni ikkinchi marta ishlamaydi
    await worker.dailyCheck(noon);
    expect(await logOf('payment_reminder')).toHaveLength(1);
  });
});

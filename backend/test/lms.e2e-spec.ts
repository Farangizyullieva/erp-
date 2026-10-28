import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { api, createApp, createTenant, Fixture, login, nextPhone, owner, tokenFor } from './helpers';

const DAY = 86_400_000;
const iso = (offsetDays: number): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(Date.now() + offsetDays * DAY));
const PDF = Buffer.from('%PDF-1.4\n% EduCRM darslik\n');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a3c50000000049454e44ae426082', 'hex');
const EXE = Buffer.from('MZ\x90\x00 not a document', 'latin1');

describe('materials, homework, rating and student settings (e2e)', () => {
  let app: INestApplication;
  let fx: Fixture;
  let token: string;
  let teacher: string;
  let unitId: string;
  let foreignUnitId: string;

  /** Multipart so'rov: fayl (ixtiyoriy) va oddiy maydonlar */
  const upload = (path: string, auth: string, fields: Record<string, string>, file?: { content: Buffer; name: string }) => {
    let req = request(app.getHttpServer()).post(`/api/v1${path}`).set('Authorization', `Bearer ${auth}`);
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return file ? req.attach('file', file.content, file.name) : req;
  };
  const fetchUrl = (url: string) => request(app.getHttpServer()).get(new URL(url).pathname + new URL(url).search);
  const student = async (name: string, unit = unitId) => {
    const id = (await api(app, token).post('/students', { full_name: name, branch_id: fx.branches.a, phone: nextPhone() })).body.data.id as string;
    await api(app, token).post(`/study-units/${unit}/members`, { student_id: id, start_date: iso(-2) });
    const creds = (await api(app, token).post(`/students/${id}/portal`, { password: 'parol-123' })).body.data as { login: string };
    return { id, token: (await login(app, fx, creds.login, 'parol-123')).body.data.access_token as string };
  };

  beforeAll(async () => {
    app = await createApp();
    fx = await createTenant();
    token = await tokenFor(app, fx, 'owner');
    teacher = await tokenFor(app, fx, 'teacher');
    const discipline = (await api(app, token).post('/dictionaries', { kind: 'discipline', name: 'Python' })).body.data.id;
    const schedule = (start: string) => ({ days: [1, 2, 3, 4, 5, 6, 7], start_time: start, end_time: `${String(Number(start.slice(0, 2)) + 1).padStart(2, '0')}:00`, period_start: iso(-3), period_end: iso(10) });
    unitId = (await api(app, token).post('/study-units', { name: 'Python 1', branch_id: fx.branches.a, discipline_id: discipline, teacher_id: fx.users.teacher.id, capacity: 10, price_amount: 1_000_000, schedule: schedule('06:00') })).body.data.id;
    // Boshqa o'qituvchining guruhi
    foreignUnitId = (await api(app, token).post('/study-units', { name: 'Python 2', branch_id: fx.branches.a, discipline_id: discipline, teacher_id: fx.users.owner.id, capacity: 10, price_amount: 1_000_000, schedule: schedule('08:00') })).body.data.id;
  });

  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  it('lets a teacher share materials only with their own group', async () => {
    const created = await upload(`/study-units/${unitId}/materials`, teacher, { title: '1-dars: kirish' }, { content: PDF, name: 'Kirish darsi.pdf' });
    expect(created.status).toBe(201);
    await upload(`/study-units/${unitId}/materials`, teacher, { title: 'Video dars', link: 'https://youtu.be/abc' });
    // Xavfli havola, ruxsat etilmagan fayl, bo'sh material, begona guruh
    expect((await upload(`/study-units/${unitId}/materials`, teacher, { title: 'Xavfli', link: 'javascript:alert(1)' })).status).toBe(400);
    expect((await upload(`/study-units/${unitId}/materials`, teacher, { title: 'Dastur' }, { content: EXE, name: 'virus.exe' })).status).toBe(400);
    expect((await upload(`/study-units/${unitId}/materials`, teacher, { title: 'Bosh' })).status).toBe(400);
    expect((await upload(`/study-units/${foreignUnitId}/materials`, teacher, { title: 'Begona' }, { content: PDF, name: 'a.pdf' })).status).toBe(404);

    const mine = await student('Material Oquvchi');
    const outsider = await student('Boshqa Guruh', foreignUnitId);
    const list = (await api(app, mine.token).get('/portal/materials')).body.data as { title: string; file: { url: string; name: string } | null; link: string | null }[];
    expect(list.map((m) => m.title).sort()).toEqual(['1-dars: kirish', 'Video dars']);
    const pdf = list.find((m) => m.file)!;
    expect(pdf.file?.name).toBe('Kirish darsi.pdf');
    const downloaded = await fetchUrl(pdf.file!.url);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers['content-type']).toContain('application/pdf');
    expect(downloaded.headers['content-disposition']).toContain(encodeURIComponent('Kirish darsi.pdf'));
    expect((await api(app, outsider.token).get('/portal/materials')).body.data).toEqual([]);
    expect((await api(app, outsider.token).get(`/portal/materials?group=${unitId}`)).body.data).toEqual([]);
  });

  it('runs the homework cycle: assign, submit, grade', async () => {
    const assigned = await upload(`/study-units/${unitId}/assignments`, teacher, { title: 'Sikllar', description: '10 ta masala', due_date: iso(3), max_score: '10' }, { content: PDF, name: 'masalalar.pdf' });
    expect(assigned.status).toBe(201);
    const assignmentId = assigned.body.data.id as string;
    const a = await student('Vazifa Bajaruvchi');
    const lazy = await student('Topshirmagan');
    const outsider = await student('Begona Vazifa', foreignUnitId);

    let mine = (await api(app, a.token).get('/portal/assignments')).body.data as { id: string; status: string; file: { name: string } }[];
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: assignmentId, status: 'new', file: { name: 'masalalar.pdf' } });

    expect((await upload(`/portal/assignments/${assignmentId}/submission`, a.token, {})).status).toBe(400);
    expect((await upload(`/portal/assignments/${assignmentId}/submission`, outsider.token, { text: 'men ham' })).status).toBe(404);
    expect((await upload(`/portal/assignments/${assignmentId}/submission`, a.token, { text: 'Javoblarim' }, { content: PNG, name: 'yechim.png' })).status).toBe(204);
    // Qayta topshirish (baholanmagan) — fayl o'zgaradi
    expect((await upload(`/portal/assignments/${assignmentId}/submission`, a.token, {}, { content: PDF, name: 'yechim.pdf' })).status).toBe(204);
    mine = (await api(app, a.token).get('/portal/assignments')).body.data;
    expect(mine[0]?.status).toBe('submitted');

    const subs = (await api(app, teacher).get(`/assignments/${assignmentId}/submissions`)).body.data as { rows: { student: { id: string }; submission: { id: string; text: string; file: { name: string } } | null }[] };
    expect(subs.rows.map((r) => [r.student.id, Boolean(r.submission)])).toEqual(expect.arrayContaining([[a.id, true], [lazy.id, false]]));
    const sub = subs.rows.find((r) => r.student.id === a.id)!.submission!;
    expect(sub).toMatchObject({ text: 'Javoblarim', file: { name: 'yechim.pdf' } });
    expect((await api(app, teacher).put(`/submissions/${sub.id}/grade`, { score: 11 })).status).toBe(400);
    expect((await api(app, teacher).put(`/submissions/${sub.id}/grade`, { score: 9, feedback: 'Zo\'r!' })).status).toBe(200);
    // Begona o'qituvchi / tashkilot baholay olmaydi
    const other = await createTenant();
    expect((await api(app, await tokenFor(app, other, 'owner')).put(`/submissions/${sub.id}/grade`, { score: 1 })).status).toBe(404);

    const graded = (await api(app, a.token).get('/portal/assignments')).body.data[0];
    expect(graded).toMatchObject({ status: 'graded', submission: { score: 9, feedback: "Zo'r!" } });
    expect((await upload(`/portal/assignments/${assignmentId}/submission`, a.token, { text: "o'zgartiraman" })).status).toBe(409);

    const stats = (await api(app, a.token).get('/portal/stats')).body.data;
    expect(stats.homework).toMatchObject({ total: 1, submitted: 1, graded: 1, average: 90 });
    expect(stats.months).toHaveLength(6);

    const rating = (await api(app, a.token).get('/portal/rating')).body.data as { group: { id: string }; rows: { name: string; points: number; me: boolean; place: number }[] }[];
    const group = rating.find((g) => g.group.id === unitId)!;
    expect(group.rows[0]).toMatchObject({ name: 'Vazifa Bajaruvchi', points: 90, me: true, place: 1 });
    // O'qituvchi o'quvchi kabinetiga kira olmaydi, o'quvchi o'qituvchi endpointiga kira olmaydi
    expect((await api(app, teacher).get('/portal/assignments')).status).toBe(403);
    expect((await api(app, a.token).get(`/assignments/${assignmentId}/submissions`)).status).toBe(403);
  });

  it('lets a student set their own photo', async () => {
    const s = await student('Rasmli Oquvchi');
    const res = await request(app.getHttpServer()).post('/api/v1/portal/photo').set('Authorization', `Bearer ${s.token}`).attach('file', PNG, 'men.png');
    expect(res.status).toBe(201);
    expect((await api(app, s.token).get('/portal/me')).body.data.student.photo_url).toBe(res.body.data.photo_url);
    expect((await request(app.getHttpServer()).post('/api/v1/portal/photo').set('Authorization', `Bearer ${s.token}`).attach('file', PDF, 'men.pdf')).status).toBe(400);
  });
});

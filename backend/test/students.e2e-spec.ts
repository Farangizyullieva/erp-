import { INestApplication } from '@nestjs/common';
import { api, createApp, createTenant, Fixture, nextPhone, owner, tokenFor } from './helpers';

describe('reference data and students (e2e)', () => {
  let app: INestApplication;
  let fx: Fixture;
  let other: Fixture;
  let ownerToken: string;

  beforeAll(async () => {
    app = await createApp();
    [fx, other] = await Promise.all([createTenant(), createTenant()]);
    ownerToken = await tokenFor(app, fx, 'owner');
  });

  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  // TZ 8.4: CI'da har bir yangi jadval uchun RLS yoqilganligi tekshiriladi
  it('every table with tenant_id has RLS enabled and forced', async () => {
    const rows = await owner.$queryRaw<{ table: string }[]>`
      SELECT c.relname AS "table"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
      WHERE c.relkind = 'r'
        AND NOT (c.relrowsecurity AND c.relforcerowsecurity
                 AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid))`;
    expect(rows.map((r) => r.table)).toEqual([]);
  });

  describe('dictionaries', () => {
    it('lets settings managers create items and everyone read them', async () => {
      const created = await api(app, ownerToken).post('/dictionaries', { kind: 'discipline', name: '  Matematika ' });
      expect(created.status).toBe(201);
      expect(created.body.data.name).toBe('Matematika');

      const dup = await api(app, ownerToken).post('/dictionaries', { kind: 'discipline', name: 'matematika' });
      expect(dup.status).toBe(400);
      expect(dup.body.error.details[0].code).toBe('DUPLICATE');
      // Boshqa turda shu nom bo'lishi mumkin
      expect((await api(app, ownerToken).post('/dictionaries', { kind: 'level', name: 'Matematika' })).status).toBe(201);

      const salesToken = await tokenFor(app, fx, 'sales');
      expect((await api(app, salesToken).post('/dictionaries', { kind: 'discipline', name: 'Fizika' })).status).toBe(403);
      const list = await api(app, salesToken).get('/dictionaries?kind=discipline');
      expect(list.body.data.map((i: { name: string }) => i.name)).toEqual(['Matematika']);
    });

    it('hides deactivated items by default and keeps tenants apart', async () => {
      const item = (await api(app, ownerToken).post('/dictionaries', { kind: 'ad_source', name: 'Radio' })).body.data;
      await api(app, ownerToken).patch(`/dictionaries/${item.id}`, { is_active: false });
      expect((await api(app, ownerToken).get('/dictionaries?kind=ad_source')).body.data).toEqual([]);
      expect((await api(app, ownerToken).get('/dictionaries?kind=ad_source&include_inactive=true')).body.data).toHaveLength(1);

      const otherToken = await tokenFor(app, other, 'owner');
      expect((await api(app, otherToken).get('/dictionaries?include_inactive=true')).body.data).toEqual([]);
      expect((await api(app, otherToken).patch(`/dictionaries/${item.id}`, { name: 'Hijack' })).status).toBe(404);
    });

    it('manages holidays', async () => {
      const created = await api(app, ownerToken).post('/holidays', { date: '2027-03-21', name: "Navro'z" });
      expect(created.status).toBe(201);
      expect(created.body.data.date).toBe('2027-03-21');
      expect((await api(app, ownerToken).post('/holidays', { date: '2027-03-21', name: 'Yana' })).status).toBe(400);
      expect((await api(app, ownerToken).get('/holidays?year=2027')).body.data).toHaveLength(1);
      expect((await api(app, ownerToken).get('/holidays?year=2026')).body.data).toEqual([]);
      expect((await api(app, ownerToken).delete(`/holidays/${created.body.data.id}`)).status).toBe(204);
    });
  });

  describe('students', () => {
    const base = () => ({ full_name: 'Karimov Aziz', branch_id: fx.branches.a, phone: nextPhone() });

    it('creates a student with a contact person and normalizes phones', async () => {
      const res = await api(app, ownerToken).post('/students', {
        full_name: ' Valiyev Sardor ',
        branch_id: fx.branches.a,
        phone: '90 123 45 67',
        birth_date: '2012-05-17',
        gender: 'male',
        contact: { full_name: 'Valiyeva Nodira', relation: 'Ona', phone: '(91) 765-43-21' },
        confirm_duplicate: true,
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        full_name: 'Valiyev Sardor',
        phone: '+998901234567',
        birth_date: '2012-05-17',
        status: 'new',
        balance: 0,
      });
      expect(res.body.data.contacts).toEqual([
        expect.objectContaining({ relation: 'Ona', phone: '+998917654321', is_bill_recipient: true }),
      ]);
    });

    it('warns about a duplicate phone but allows confirming it', async () => {
      const payload = base();
      expect((await api(app, ownerToken).post('/students', payload)).status).toBe(201);

      const dup = await api(app, ownerToken).post('/students', { ...payload, full_name: 'Karimov Bobur' });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('POSSIBLE_DUPLICATE');
      expect(dup.body.error.details[0].message).toContain('Karimov Aziz');

      const confirmed = await api(app, ownerToken).post('/students', { ...payload, full_name: 'Karimov Bobur', confirm_duplicate: true });
      expect(confirmed.status).toBe(201);
    });

    it('rejects invalid input and foreign references', async () => {
      const bad = await api(app, ownerToken).post('/students', { full_name: 'A', branch_id: fx.branches.a, phone: '123' });
      expect(bad.status).toBe(400);
      const foreignBranch = await api(app, ownerToken).post('/students', { full_name: 'Test Test', branch_id: other.branches.a });
      expect(foreignBranch.status).toBe(400);
      const level = (await api(app, ownerToken).post('/dictionaries', { kind: 'level', name: 'C1' })).body.data;
      // Boshqa turdagi ma'lumotnoma yozuvini manba sifatida berib bo'lmaydi
      const wrongKind = await api(app, ownerToken).post('/students', { ...base(), ad_source_id: level.id });
      expect(wrongKind.status).toBe(400);
      expect(wrongKind.body.error.details[0].field).toBe('ad_source_id');
    });

    it('applies branch scoping', async () => {
      const inB = (await api(app, ownerToken).post('/students', { ...base(), branch_id: fx.branches.b })).body.data;
      const inA = (await api(app, ownerToken).post('/students', base())).body.data;
      const managerToken = await tokenFor(app, fx, 'managerA');

      const list = await api(app, managerToken).get('/students?limit=200');
      const ids = list.body.data.map((s: { id: string }) => s.id);
      expect(ids).toContain(inA.id);
      expect(ids).not.toContain(inB.id);
      expect((await api(app, managerToken).get(`/students/${inB.id}`)).status).toBe(404);
      expect((await api(app, managerToken).patch(`/students/${inB.id}`, { note: 'x' })).status).toBe(404);
      expect((await api(app, managerToken).post('/students', { ...base(), branch_id: fx.branches.b })).status).toBe(404);
      // O'quvchini ruxsat yo'q filialga ko'chirib bo'lmaydi
      expect((await api(app, managerToken).patch(`/students/${inA.id}`, { branch_id: fx.branches.b })).status).toBe(404);
    });

    it('applies ownership scoping and hides contacts without student.view_contacts', async () => {
      const mine = (await api(app, ownerToken).post('/students', { ...base(), owner_id: fx.users.teacher.id })).body.data;
      const notMine = (await api(app, ownerToken).post('/students', base())).body.data;
      const teacherToken = await tokenFor(app, fx, 'teacher');

      const list = await api(app, teacherToken).get('/students');
      expect(list.body.data.map((s: { id: string }) => s.id)).toEqual([mine.id]);
      expect(list.body.data[0].phone).toBeNull();
      expect((await api(app, teacherToken).get(`/students/${notMine.id}`)).status).toBe(404);

      const detail = await api(app, teacherToken).get(`/students/${mine.id}`);
      expect(detail.body.data).toMatchObject({ phone: null, email: null, contacts: [], contacts_hidden: true });
      // Telefon bo'yicha qidirib ham topib bo'lmaydi
      const byPhone = await api(app, teacherToken).get(`/students?q=${encodeURIComponent(mine.phone.slice(-7))}`);
      expect(byPhone.body.data).toEqual([]);
      expect((await api(app, teacherToken).post('/students', base())).status).toBe(403);
    });

    it('searches, filters by status and archives instead of deleting', async () => {
      const s = (await api(app, ownerToken).post('/students', { ...base(), full_name: 'Zokirova Unikal' })).body.data;
      const byName = await api(app, ownerToken).get('/students?q=unikal');
      expect(byName.body.data.map((x: { id: string }) => x.id)).toEqual([s.id]);
      const byPhone = await api(app, ownerToken).get(`/students?q=${s.phone.slice(-7)}`);
      expect(byPhone.body.data.map((x: { id: string }) => x.id)).toEqual([s.id]);

      const archived = await api(app, ownerToken).post(`/students/${s.id}/archive`);
      expect(archived.body.data.status).toBe('archived');
      expect((await api(app, ownerToken).get('/students?q=unikal')).body.data).toEqual([]);
      const inArchive = await api(app, ownerToken).get('/students?q=unikal&filter[status]=archived');
      expect(inArchive.body.data).toHaveLength(1);
      const restored = await api(app, ownerToken).post(`/students/${s.id}/unarchive`);
      expect(restored.body.data).toMatchObject({ status: 'new', archived_at: null });
    });

    it('assigns sequential student numbers per tenant and finds students by number', async () => {
      const first = (await api(app, ownerToken).post('/students', base())).body.data;
      const second = (await api(app, ownerToken).post('/students', base())).body.data;
      expect(second.number).toBe(first.number + 1);

      // Parallel yaratishda raqamlar takrorlanmaydi
      const batch = await Promise.all(Array.from({ length: 8 }, () => api(app, ownerToken).post('/students', base())));
      const numbers = batch.map((r) => r.body.data.number as number);
      expect(new Set(numbers).size).toBe(8);
      expect(Math.min(...numbers)).toBe(second.number + 1);
      expect(Math.max(...numbers)).toBe(second.number + 8);

      for (const q of [`#${first.number}`, String(first.number).padStart(5, '0')]) {
        const found = await api(app, ownerToken).get(`/students?q=${encodeURIComponent(q)}`);
        expect(found.body.data.map((s: { id: string }) => s.id)).toContain(first.id);
      }
      // Boshqa tenant o'z raqamlashini 1 dan boshlaydi
      const fresh = await createTenant();
      const foreign = await api(app, await tokenFor(app, fresh, 'owner')).post('/students', { full_name: 'Other Tenant', branch_id: fresh.branches.a });
      expect(foreign.body.data.number).toBe(1);
    });

    it('updates, clears optional fields and records history', async () => {
      const s = (await api(app, ownerToken).post('/students', { ...base(), birth_date: '2010-01-01' })).body.data;
      const updated = await api(app, ownerToken).patch(`/students/${s.id}`, {
        full_name: 'Karimov Azizbek',
        birth_date: '',
        blacklisted: true,
        blacklist_reason: "To'lamagan",
      });
      expect(updated.body.data).toMatchObject({ full_name: 'Karimov Azizbek', birth_date: null, blacklisted: true });

      const history = await api(app, ownerToken).get(`/students/${s.id}/history`);
      const actions = history.body.data.map((h: { action: string }) => h.action);
      expect(actions).toEqual(['student.updated', 'student.created']);
      expect(history.body.data[0].actor).toBe('Owner');
      expect(history.body.data[0].changes).toEqual(
        expect.arrayContaining([{ field: 'full_name', from: 'Karimov Aziz', to: 'Karimov Azizbek' }]),
      );
    });

    it('manages contact persons with a single bill recipient', async () => {
      const s = (await api(app, ownerToken).post('/students', base())).body.data;
      const mother = await api(app, ownerToken).post(`/students/${s.id}/contacts`, { full_name: 'Karimova Dilnoza', relation: 'Ona', phone: nextPhone() });
      expect(mother.body.data.is_bill_recipient).toBe(true);
      const father = await api(app, ownerToken).post(`/students/${s.id}/contacts`, {
        full_name: 'Karimov Anvar',
        relation: 'Ota',
        is_bill_recipient: true,
      });
      expect(father.status).toBe(201);

      let detail = await api(app, ownerToken).get(`/students/${s.id}`);
      expect(detail.body.data.contacts.filter((c: { is_bill_recipient: boolean }) => c.is_bill_recipient)).toHaveLength(1);

      // Boshqa o'quvchi orqali begona aloqa shaxsini o'zgartirib bo'lmaydi (IDOR)
      const stranger = (await api(app, ownerToken).post('/students', base())).body.data;
      expect((await api(app, ownerToken).patch(`/students/${stranger.id}/contacts/${father.body.data.id}`, { relation: 'X' })).status).toBe(404);

      expect((await api(app, ownerToken).delete(`/students/${s.id}/contacts/${mother.body.data.id}`)).status).toBe(204);
      detail = await api(app, ownerToken).get(`/students/${s.id}`);
      expect(detail.body.data.contacts).toHaveLength(1);
    });

    it("does not expose another tenant's students", async () => {
      const s = (await api(app, ownerToken).post('/students', base())).body.data;
      const otherToken = await tokenFor(app, other, 'owner');
      expect((await api(app, otherToken).get(`/students/${s.id}`)).status).toBe(404);
      expect((await api(app, otherToken).get('/students')).body.data).toEqual([]);
    });

    it('builds the dashboard summary within the caller\'s scope', async () => {
      const full = (await api(app, ownerToken).get('/dashboard/summary')).body.data;
      expect(full.students.total).toBeGreaterThan(5);
      expect(full.students.daily).toHaveLength(30);
      expect(full.students.daily.at(-1).count).toBe(full.students.total + full.students.by_status.archived);
      expect(full.students.new_this_month).toBeGreaterThan(0);
      expect(full.students.by_branch.map((b: { branch: string }) => b.branch)).toEqual(expect.arrayContaining(['Filial A', 'Filial B']));
      expect(full.company).toEqual({ branches: 2, classrooms: 0 });
      expect(full.recent_students).toHaveLength(6);
      expect(full.recent_students[0]).toEqual(expect.objectContaining({ number: expect.any(Number), branch: expect.any(String) }));

      const scoped = (await api(app, await tokenFor(app, fx, 'managerA')).get('/dashboard/summary')).body.data;
      expect(scoped.students.total).toBeLessThan(full.students.total);
      expect(scoped.students.by_branch.map((b: { branch: string }) => b.branch)).toEqual(['Filial A']);
      expect(scoped.company.branches).toBe(1);

      // Filial filtri va davr
      const onlyB = (await api(app, ownerToken).get(`/dashboard/summary?branch_id=${fx.branches.b}&days=7`)).body.data;
      expect(onlyB.students.by_branch.map((b: { branch: string }) => b.branch)).toEqual(['Filial B']);
      expect(onlyB.students.daily).toHaveLength(7);
      expect(onlyB.company.branches).toBe(1);
      const managerToken = await tokenFor(app, fx, 'managerA');
      expect((await api(app, managerToken).get(`/dashboard/summary?branch_id=${fx.branches.b}`)).status).toBe(404);
      expect((await api(app, ownerToken).get('/dashboard/summary?days=13')).status).toBe(400);

      const teacher = (await api(app, await tokenFor(app, fx, 'teacher')).get('/dashboard/summary')).body.data;
      expect(teacher.students.total).toBe(1);
      expect(teacher).toMatchObject({ company: null, employees: null });
      // O'qituvchi kontaktlarni ko'ra olmaydi — ish stolida ham
      expect(teacher.recent_students).toEqual([expect.objectContaining({ phone: null })]);

      const empty = (await api(app, await tokenFor(app, other, 'owner')).get('/dashboard/summary')).body.data;
      expect(empty.students.total).toBe(0);
    });

    it('lists employee options without employee.view', async () => {
      const res = await api(app, await tokenFor(app, fx, 'sales')).get('/employees/options');
      expect(res.status).toBe(200);
      expect(res.body.data.map((e: { full_name: string }) => e.full_name)).toEqual(expect.arrayContaining(['Sales', 'Manager A']));
      expect(Object.keys(res.body.data[0]).sort()).toEqual(['full_name', 'id']);
    });
  });
});

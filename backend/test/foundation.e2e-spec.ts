import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { api, createApp, createTenant, Fixture, login, nextPhone, owner, PASSWORD, tokenFor, Tokens } from './helpers';

describe('foundation (e2e)', () => {
  let app: INestApplication;
  let t1: Fixture;
  let t2: Fixture;
  // Ilova roli bilan to'g'ridan-to'g'ri ulanish — RLS'ni API'siz tekshirish uchun
  const appRole = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

  beforeAll(async () => {
    app = await createApp();
    [t1, t2] = await Promise.all([createTenant(), createTenant()]);
  });

  afterAll(async () => {
    await app.close();
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
  });

  describe('auth', () => {
    it('rejects requests without a token and sets X-Request-Id', async () => {
      const res = await api(app).get('/branches');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expect(res.headers['x-request-id']).toBe(res.body.error.request_id);
    });

    it('logs in and returns the permission map on /auth/me', async () => {
      const res = await login(app, t1, t1.users.owner.phone);
      expect(res.status).toBe(200);
      const me = await api(app, (res.body.data as Tokens).access_token).get('/auth/me');
      expect(me.body.data.roles).toEqual(['owner']);
      expect(me.body.data.permissions['payment.delete']).toBe('all');
    });

    it('does not let a user log in through another tenant', async () => {
      const res = await login(app, t2, t1.users.owner.phone);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('rotates refresh tokens and revokes the family on reuse', async () => {
      const first = (await login(app, t1, t1.users.sales.phone)).body.data as Tokens;
      const second = await api(app).post('/auth/refresh', { refresh_token: first.refresh_token });
      expect(second.status).toBe(200);
      const rotated = second.body.data as Tokens;
      expect(rotated.refresh_token).not.toBe(first.refresh_token);

      const reuse = await api(app).post('/auth/refresh', { refresh_token: first.refresh_token });
      expect(reuse.status).toBe(401);
      // O'g'irlangan token ishlatilgan deb hisoblanadi → yangi token ham bekor
      const afterReuse = await api(app).post('/auth/refresh', { refresh_token: rotated.refresh_token });
      expect(afterReuse.status).toBe(401);
    });

    it('locks the account after 5 failed attempts', async () => {
      const created = await api(app, await tokenFor(app, t1, 'owner')).post('/employees', {
        full_name: 'Lock Me',
        phone: nextPhone(),
        password: PASSWORD,
        role_ids: [t1.roles.teacher],
      });
      const phone = created.body.data.phone as string;
      for (let i = 0; i < 5; i++) expect((await login(app, t1, phone, 'wrong-password')).status).toBe(401);
      const locked = await login(app, t1, phone);
      expect(locked.status).toBe(429);
      expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
    });
  });

  describe('row-level security', () => {
    it('shows nothing when the tenant is not set, even to the table owner', async () => {
      expect(await appRole.user.count()).toBe(0);
      expect(await appRole.branch.count()).toBe(0);
      expect(await owner.user.count()).toBe(0);
    });

    it('isolates tenants and blocks writes under another tenant id', async () => {
      await appRole.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${t1.tenantId}, true)`;
        const branches = await tx.branch.findMany();
        expect(branches.map((b) => b.id).sort()).toEqual([t1.branches.a, t1.branches.b].sort());
      });
      await expect(
        appRole.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_tenant', ${t1.tenantId}, true)`;
          await tx.branch.create({ data: { tenantId: t2.tenantId, name: 'Hijack', code: 'X' } });
        }),
      ).rejects.toThrow(/row-level security/);
    });

    it('does not leak the tenant setting into the pooled connection', async () => {
      await appRole.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${t1.tenantId}, true)`;
      });
      for (let i = 0; i < 10; i++) expect(await appRole.branch.count()).toBe(0);
    });

    it('returns 404 for another tenant\'s branch through the API', async () => {
      const res = await api(app, await tokenFor(app, t1, 'owner')).get(`/branches/${t2.branches.a}`);
      expect(res.status).toBe(404);
    });
  });

  describe('audit log', () => {
    it('records changes and rejects UPDATE/DELETE with an error', async () => {
      const token = await tokenFor(app, t1, 'owner');
      const created = await api(app, token).post('/branches', { name: 'Chilonzor', code: 'chz' });
      expect(created.status).toBe(201);
      expect(created.body.data.code).toBe('CHZ');

      await owner.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${t1.tenantId}, true)`;
        const row = await tx.auditLog.findFirstOrThrow({ where: { entityId: created.body.data.id } });
        expect(row.action).toBe('branch.created');
        expect(row.actorId).toBe(t1.users.owner.id);
      });
      const mutate = (sql: 'update' | 'delete') =>
        owner.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_tenant', ${t1.tenantId}, true)`;
          return sql === 'update' ? tx.auditLog.updateMany({ data: { action: 'x' } }) : tx.auditLog.deleteMany();
        });
      await expect(mutate('update')).rejects.toThrow(/append-only/);
      await expect(mutate('delete')).rejects.toThrow(/append-only/);
      await expect(
        appRole.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_tenant', ${t1.tenantId}, true)`;
          return tx.auditLog.deleteMany();
        }),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe('permissions and scoping', () => {
    it('sales_manager cannot create a branch or list employees', async () => {
      const token = await tokenFor(app, t1, 'sales');
      expect((await api(app, token).post('/branches', { name: 'Nope', code: 'NO' })).status).toBe(403);
      expect((await api(app, token).get('/employees')).status).toBe(403);
      expect((await api(app, token).get('/branches')).status).toBe(200);
    });

    it('branch_manager sees only their own branch and its employees', async () => {
      const token = await tokenFor(app, t1, 'managerA');
      const branches = await api(app, token).get('/branches');
      expect(branches.body.data.map((b: { id: string }) => b.id)).toEqual([t1.branches.a]);
      expect((await api(app, token).get(`/branches/${t1.branches.b}`)).status).toBe(404);
      expect((await api(app, token).post(`/branches/${t1.branches.b}/classrooms`, { name: '1', capacity: 10 })).status).toBe(404);

      const employees = await api(app, token).get('/employees');
      const ids = employees.body.data.map((e: { id: string }) => e.id);
      expect(ids).toEqual(expect.arrayContaining([t1.users.managerA.id, t1.users.sales.id]));
      expect(ids).not.toContain(t1.users.owner.id);
      expect((await api(app, token).get(`/employees/${t1.users.owner.id}`)).status).toBe(404);
    });

    it('prevents privilege escalation through role assignment', async () => {
      const token = await tokenFor(app, t1, 'managerA');
      const base = { full_name: 'New Hire', password: PASSWORD, branch_ids: [t1.branches.a] };
      const asOwner = await api(app, token).post('/employees', { ...base, phone: nextPhone(), role_ids: [t1.roles.owner] });
      expect(asOwner.status).toBe(403);
      const otherBranch = await api(app, token).post('/employees', {
        ...base,
        phone: nextPhone(),
        role_ids: [t1.roles.teacher],
        branch_ids: [t1.branches.b],
      });
      expect(otherBranch.status).toBe(403);
      const allBranches = await api(app, token).post('/employees', {
        ...base,
        phone: nextPhone(),
        role_ids: [t1.roles.teacher],
        branch_ids: [],
      });
      expect(allBranches.status).toBe(400);
      const ok = await api(app, token).post('/employees', { ...base, phone: nextPhone(), role_ids: [t1.roles.teacher] });
      expect(ok.status).toBe(201);
    });

    it('keeps the owner role immutable and copies roles', async () => {
      const token = await tokenFor(app, t1, 'owner');
      const locked = await api(app, token).put(`/roles/${t1.roles.owner}/permissions`, { permissions: [] });
      expect(locked.status).toBe(409);

      const copy = await api(app, token).post('/roles', {
        code: 'senior_sales',
        name: 'Katta sotuvchi',
        copy_from_role_id: t1.roles.sales_manager,
      });
      expect(copy.status).toBe(201);
      expect(copy.body.data.permissions.length).toBeGreaterThan(5);
      const updated = await api(app, token).put(`/roles/${copy.body.data.id}/permissions`, {
        permissions: [{ code: 'lead.view', scope: 'own' }],
      });
      expect(updated.body.data.permissions).toEqual([{ code: 'lead.view', scope: 'own' }]);
      const unknown = await api(app, token).put(`/roles/${copy.body.data.id}/permissions`, {
        permissions: [{ code: 'nope.nope', scope: 'all' }],
      });
      expect(unknown.status).toBe(400);
    });

    it('deactivated employee loses access immediately', async () => {
      const ownerToken = await tokenFor(app, t1, 'owner');
      const phone = nextPhone();
      const created = await api(app, ownerToken).post('/employees', {
        full_name: 'Temp',
        phone,
        password: PASSWORD,
        role_ids: [t1.roles.administrator],
      });
      const tokens = (await login(app, t1, phone)).body.data as Tokens;
      expect((await api(app, tokens.access_token).get('/branches')).status).toBe(200);

      expect((await api(app, ownerToken).post(`/employees/${created.body.data.id}/deactivate`)).status).toBe(200);
      expect((await api(app, tokens.access_token).get('/branches')).status).toBe(401);
      expect((await api(app).post('/auth/refresh', { refresh_token: tokens.refresh_token })).status).toBe(401);
      expect((await login(app, t1, phone)).status).toBe(401);
    });
  });

  describe('list conventions', () => {
    it('validates input with field-level details', async () => {
      const res = await api(app, await tokenFor(app, t1, 'owner')).post('/employees', {
        full_name: 'X',
        phone: '12345',
        password: 'short',
        role_ids: [],
        is_admin: true,
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      const fields = res.body.error.details.map((d: { field: string }) => d.field);
      expect(fields).toEqual(expect.arrayContaining(['full_name', 'password', 'role_ids', 'is_admin']));
    });

    it('paginates by cursor and parses filter[...] query', async () => {
      const token = await tokenFor(app, t1, 'owner');
      const page1 = await api(app, token).get('/employees?limit=2&with_total=true&filter[is_active]=true');
      expect(page1.status).toBe(200);
      expect(page1.body.data).toHaveLength(2);
      expect(page1.body.meta.total).toBeGreaterThanOrEqual(3);
      expect(page1.body.meta.next_cursor).toEqual(expect.any(String));

      const seen = new Set<string>(page1.body.data.map((e: { id: string }) => e.id));
      let cursor: string | null = page1.body.meta.next_cursor;
      while (cursor) {
        const page = await api(app, token).get(`/employees?limit=2&filter[is_active]=true&cursor=${cursor}`);
        expect(page.body.meta.total).toBeUndefined();
        for (const e of page.body.data as { id: string }[]) {
          expect(seen.has(e.id)).toBe(false);
          seen.add(e.id);
        }
        cursor = page.body.meta.next_cursor;
      }
      expect(seen.size).toBe(page1.body.meta.total);

      const inactive = await api(app, token).get('/employees?filter[is_active]=false');
      expect(inactive.body.data.every((e: { is_active: boolean }) => !e.is_active)).toBe(true);
    });
  });
});

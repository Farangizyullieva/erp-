import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { safeJoin, sniffFileType, validateUpload } from '../src/common/security/files';
import { assertPublicUrl, isPrivateAddress } from '../src/common/security/safe-url';
import { currentStep, SecretBox, totpCode, verifyTotp } from '../src/common/security/totp';
import { api, createApp, createTenant, Fixture, login, owner, PASSWORD, tokenFor } from './helpers';

describe('security hardening', () => {
  let app: INestApplication;
  let fx: Fixture;

  beforeAll(async () => {
    app = await createApp();
    fx = await createTenant();
  });

  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  describe('SQL injection', () => {
    it('treats injection payloads in search and filters as plain data', async () => {
      const token = await tokenFor(app, fx, 'owner');
      await api(app, token).post('/students', { full_name: "Robert'); DROP TABLE students;--", branch_id: fx.branches.a });
      for (const q of ["' OR '1'='1", "'; DROP TABLE students;--", '%" OR 1=1 --', "\\' UNION SELECT password_hash FROM users --"]) {
        const res = await api(app, token).get(`/students?q=${encodeURIComponent(q)}`);
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([]);
      }
      const found = await api(app, token).get(`/students?q=${encodeURIComponent('DROP TABLE')}`);
      expect(found.body.data).toHaveLength(1);
      expect((await api(app, token).get("/students?filter[branch_id]=' OR 1=1--")).status).toBe(400);
    });
  });

  describe('JWT attacks', () => {
    const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');

    it('rejects unsigned, tampered and wrongly signed tokens', async () => {
      const token = await tokenFor(app, fx, 'sales');
      const [header, payload, signature] = token.split('.') as [string, string, string];
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>;

      const none = `${b64({ alg: 'none', typ: 'JWT' })}.${payload}.`;
      const escalated = `${header}.${b64({ ...claims, sub: fx.users.owner.id })}.${signature}`;
      const hs512 = `${b64({ alg: 'HS512', typ: 'JWT' })}.${payload}.${signature}`;
      for (const forged of [none, escalated, hs512, 'not-a-jwt']) {
        const res = await api(app, forged).get('/auth/me');
        expect(res.status).toBe(401);
      }
      expect((await api(app, token).get('/auth/me')).status).toBe(200);
    });
  });

  describe('prototype pollution and payload limits', () => {
    it('rejects __proto__ / constructor keys in body and query', async () => {
      const token = await tokenFor(app, fx, 'owner');
      const body = await request(app.getHttpServer())
        .post('/api/v1/students')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send('{"full_name":"Test Test","branch_id":"' + fx.branches.a + '","__proto__":{"isAdmin":true}}');
      expect(body.status).toBe(400);
      expect(body.body.error.code).toBe('FORBIDDEN_KEY');

      const nested = await api(app, token).post('/students', { full_name: 'Test Test', branch_id: fx.branches.a, contact: { constructor: { prototype: { x: 1 } } } });
      expect(nested.body.error.code).toBe('FORBIDDEN_KEY');
      expect((await api(app, token).get('/students?filter[constructor][prototype][x]=1')).status).toBe(400);
      expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
    });

    it('rejects oversized and deeply nested payloads', async () => {
      const token = await tokenFor(app, fx, 'owner');
      const big = await api(app, token).post('/students', { full_name: 'Big', branch_id: fx.branches.a, note: 'x'.repeat(300_000) });
      expect(big.status).toBe(413);

      let deep: Record<string, unknown> = {};
      for (let i = 0; i < 30; i++) deep = { a: deep };
      const res = await api(app, token).post('/students', { full_name: 'Deep', branch_id: fx.branches.a, contact: deep });
      expect(res.body.error.code).toBe('PAYLOAD_TOO_COMPLEX');
    });
  });

  describe('security headers', () => {
    it('sends restrictive headers and does not reveal the framework', async () => {
      const res = await request(app.getHttpServer()).get('/health/live');
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('two-factor authentication (TOTP)', () => {
    const box = new SecretBox(process.env.SECRETS_ENC_KEY);

    it('requires a valid one-time code after it is enabled', async () => {
      const phone = fx.users.managerA.phone;
      const token = await tokenFor(app, fx, 'managerA');
      expect((await api(app, token).get('/auth/2fa')).body.data).toEqual({ enabled: false, recommended: false });

      expect((await api(app, token).post('/auth/2fa/setup', { password: 'wrong-password' })).status).toBe(400);
      const setup = await api(app, token).post('/auth/2fa/setup', { password: PASSWORD });
      const secret = setup.body.data.secret as string;
      expect(setup.body.data.otpauth_url).toContain(`secret=${secret}`);

      // Kalit bazada ochiq holda saqlanmaydi
      const stored = await owner.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${fx.tenantId}, true)`;
        return tx.user.findUniqueOrThrow({ where: { id: fx.users.managerA.id } });
      });
      expect(stored.totpSecret).not.toContain(secret);
      expect(box.decrypt(stored.totpSecret as string)).toBe(secret);

      // Tasdiqlanmaguncha yoqilmaydi
      expect((await login(app, fx, phone)).status).toBe(200);
      expect((await api(app, token).post('/auth/2fa/enable', { code: '000000' })).status).toBe(400);
      const step = currentStep();
      expect((await api(app, token).post('/auth/2fa/enable', { code: totpCode(secret, step) })).body.data).toEqual({ enabled: true });

      const noCode = await login(app, fx, phone);
      expect(noCode.status).toBe(401);
      expect(noCode.body.error.code).toBe('TOTP_REQUIRED');

      const send = (totp_code: string) => request(app.getHttpServer()).post('/api/v1/auth/login').send({ login: phone, password: PASSWORD, tenant: fx.slug, totp_code });
      expect((await send('123456')).body.error.code).toBe('TOTP_INVALID');
      // Yoqishda ishlatilgan kodni qayta ishlatib bo'lmaydi (replay)
      expect((await send(totpCode(secret, step))).body.error.code).toBe('TOTP_INVALID');
      const ok = await send(totpCode(secret, step + 1));
      expect(ok.status).toBe(200);
      expect((await send(totpCode(secret, step + 1))).status).toBe(401);

      // O'chirish uchun parol va yangi kod kerak
      const fresh = ok.body.data.access_token as string;
      expect((await api(app, fresh).post('/auth/2fa/disable', { password: PASSWORD, code: totpCode(secret, step + 1) })).status).toBe(400);
      expect((await api(app, fresh).post('/auth/2fa/disable', { password: 'nope', code: totpCode(secret, step + 2) })).status).toBe(400);
    });

    it('verifies codes within a ±1 step window only', () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const now = 1_700_000_000_000;
      const step = currentStep(now);
      // RFC 6238 test vektori (SHA-1, "12345678901234567890", T = 59 s → 287082)
      expect(totpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1)).toBe('287082');
      expect(verifyTotp(secret, totpCode(secret, step), null, now)).toBe(step);
      expect(verifyTotp(secret, totpCode(secret, step - 1), null, now)).toBe(step - 1);
      expect(verifyTotp(secret, totpCode(secret, step - 2), null, now)).toBeNull();
      expect(verifyTotp(secret, totpCode(secret, step), step, now)).toBeNull();
      expect(verifyTotp(secret, 'abcdef', null, now)).toBeNull();
    });
  });

  describe('SSRF', () => {
    it('recognises private and special addresses', () => {
      for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:10.0.0.1']) {
        expect(isPrivateAddress(ip)).toBe(true);
      }
      for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111']) expect(isPrivateAddress(ip)).toBe(false);
    });

    it('blocks internal targets, credentials and non-http schemes', async () => {
      for (const url of ['http://127.0.0.1:5432/', 'http://localhost/admin', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'file:///etc/passwd', 'gopher://x', 'http://user:pass@8.8.8.8/', 'not a url']) {
        await expect(assertPublicUrl(url)).rejects.toMatchObject({ status: 400 });
      }
      await expect(assertPublicUrl('https://8.8.8.8/hook')).resolves.toMatchObject({ address: '8.8.8.8' });
    });
  });

  describe('path traversal and file upload', () => {
    it('keeps paths inside the root directory', () => {
      expect(safeJoin('/srv/files', 'tenant/a.pdf')).toBe('/srv/files/tenant/a.pdf');
      for (const bad of ['../etc/passwd', 'a/../../etc/passwd', '/etc/passwd', 'a\0.pdf', '..\\windows', '../files-evil/x']) {
        expect(() => safeJoin('/srv/files', bad)).toThrow();
      }
    });

    it('detects the real file type and ignores the claimed one', () => {
      const pdf = Buffer.from('%PDF-1.7\n...');
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
      const script = Buffer.from('<?php system($_GET["c"]); ?>');
      const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);
      expect(sniffFileType(pdf)?.mime).toBe('application/pdf');
      expect(sniffFileType(script)).toBeNull();

      const saved = validateUpload(png, ['image/png', 'application/pdf']);
      expect(saved.storageName).toMatch(/^[0-9a-f-]{36}\.png$/);
      // PNG deb yuborilgan skript yoki .exe rad etiladi
      expect(() => validateUpload(script, ['image/png'])).toThrow();
      expect(() => validateUpload(exe, ['image/png'])).toThrow();
      expect(() => validateUpload(pdf, ['image/png'])).toThrow();
      expect(() => validateUpload(Buffer.alloc(0), ['image/png'])).toThrow();
      expect(() => validateUpload(Buffer.concat([pdf, Buffer.alloc(2000)]), ['application/pdf'], 1000)).toThrow();
    });
  });
});

import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { ALL_PERMISSIONS, SYSTEM_ROLES } from '../src/common/auth/permissions.catalog';

export const PASSWORD = 'correct-horse-battery';

/** Jadval egasi roli — fixture yaratish uchun; FORCE RLS sabab u ham tenant o'rnatishi shart */
export const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_MIGRATE_URL });

export async function createApp(customize?: (builder: TestingModuleBuilder) => TestingModuleBuilder): Promise<INestApplication> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  const moduleRef = await (customize ? customize(builder) : builder).compile();
  const app = moduleRef.createNestApplication({ bodyParser: false });
  configureApp(app);
  await app.init();
  return app;
}

let phoneSeq = Math.floor(Math.random() * 8_000_000) + 1_000_000;
export const nextPhone = (): string => `+99890${String(phoneSeq++).padStart(7, '0')}`;

export interface Fixture {
  tenantId: string;
  slug: string;
  roles: Record<string, string>;
  branches: { a: string; b: string };
  users: Record<'owner' | 'managerA' | 'sales' | 'teacher' | 'admin', { id: string; phone: string }>;
}

/** Alohida tenant: tizim rollari, ikki filial, owner + A filial boshqaruvchisi + sotuv menejeri */
export async function createTenant(): Promise<Fixture> {
  const slug = `t-${randomBytes(6).toString('hex')}`;
  await owner.permission.createMany({
    data: ALL_PERMISSIONS.map((p) => ({ code: p.code, group: p.group, description: p.code })),
    skipDuplicates: true,
  });
  const tenant = await owner.tenant.create({ data: { slug, name: slug } });
  const passwordHash = await hash(PASSWORD);

  return owner.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenant.id}, true)`;
    const roles: Record<string, string> = {};
    for (const seed of SYSTEM_ROLES) {
      const role = await tx.role.create({
        data: {
          tenantId: tenant.id,
          code: seed.code,
          name: seed.name,
          isSystem: true,
          permissions: {
            create: [...new Set(seed.permissions)].map((permissionCode) => ({
              tenantId: tenant.id,
              permissionCode,
              scope: seed.scope,
            })),
          },
        },
      });
      roles[seed.code] = role.id;
    }
    const a = await tx.branch.create({ data: { tenantId: tenant.id, name: 'Filial A', code: 'A' } });
    const b = await tx.branch.create({ data: { tenantId: tenant.id, name: 'Filial B', code: 'B' } });

    const mkUser = async (fullName: string, role: string, branchIds: string[]) => {
      const phone = nextPhone();
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          fullName,
          phone,
          passwordHash,
          roles: { create: { tenantId: tenant.id, roleId: roles[role] as string } },
          branches: { create: branchIds.map((branchId) => ({ tenantId: tenant.id, branchId })) },
        },
      });
      return { id: user.id, phone };
    };

    return {
      tenantId: tenant.id,
      slug,
      roles,
      branches: { a: a.id, b: b.id },
      users: {
        owner: await mkUser('Owner', 'owner', []),
        managerA: await mkUser('Manager A', 'branch_manager', [a.id]),
        sales: await mkUser('Sales', 'sales_manager', [a.id]),
        teacher: await mkUser('Teacher', 'teacher', [a.id]),
        admin: await mkUser('Admin', 'administrator', [a.id]),
      },
    };
  });
}

export interface Tokens {
  access_token: string;
  refresh_token: string;
}

export async function login(app: INestApplication, fx: Fixture, phone: string, password = PASSWORD) {
  return request(app.getHttpServer()).post('/api/v1/auth/login').send({ login: phone, password, tenant: fx.slug });
}

export async function tokenFor(app: INestApplication, fx: Fixture, who: keyof Fixture['users']): Promise<string> {
  const res = await login(app, fx, fx.users[who].phone);
  return (res.body.data as Tokens).access_token;
}

export const api = (app: INestApplication, token?: string) => {
  const agent = request(app.getHttpServer());
  const auth = <T extends request.Test>(t: T): T => (token ? t.set('Authorization', `Bearer ${token}`) : t);
  return {
    get: (url: string) => auth(agent.get(`/api/v1${url}`)),
    post: (url: string, body?: object) => auth(agent.post(`/api/v1${url}`)).send(body),
    patch: (url: string, body?: object) => auth(agent.patch(`/api/v1${url}`)).send(body),
    put: (url: string, body?: object) => auth(agent.put(`/api/v1${url}`)).send(body),
    delete: (url: string) => auth(agent.delete(`/api/v1${url}`)),
  };
};

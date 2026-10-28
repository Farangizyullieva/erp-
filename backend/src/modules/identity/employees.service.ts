import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { FilesService } from '../../common/files/files.service';
import { Notifier } from '../../common/notifications/notifier.service';
import { branchIdFilter, canAccessBranch } from '../../common/auth/scoping';
import { AuthContext, RequestContextStore } from '../../common/context/request-context';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { AppError } from '../../common/http/app-error';
import { cursorWhere, decodeCursor, toPage } from '../../common/utils/pagination';
import { requirePhone } from '../../common/utils/phone';
import { hashPassword } from './auth.service';
import { CreateEmployeeDto, EmployeeQuery, UpdateEmployeeDto } from './dto/employees.dto';
import { assertCanGrant } from './roles.service';

const include = {
  roles: { select: { role: { select: { id: true, code: true, name: true } } } },
  branches: { select: { branch: { select: { id: true, name: true, code: true } } } },
} satisfies Prisma.UserInclude;

type Employee = Prisma.UserGetPayload<{ include: typeof include }>;

const view = (u: Employee) => ({
  id: u.id,
  full_name: u.fullName,
  phone: u.phone,
  email: u.email,
  is_active: u.isActive,
  last_login_at: u.lastLoginAt,
  created_at: u.createdAt,
  roles: u.roles.map((r) => r.role),
  branches: u.branches.map((b) => b.branch),
});

@Injectable()
export class EmployeesService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
    private readonly notifier: Notifier,
    private readonly files: FilesService,
  ) {}

  list(query: EmployeeQuery) {
    const auth = RequestContextStore.auth();
    const limit = query.limit ?? 50;
    const f = query.filter ?? {};
    const and: Prisma.UserWhereInput[] = [this.scope(auth), cursorWhere(decodeCursor(query.cursor))];
    if (f.is_active !== undefined) and.push({ isActive: f.is_active === 'true' });
    if (f.branch_id) and.push({ branches: { some: { branchId: f.branch_id } } });
    if (f.role_id) and.push({ roles: { some: { roleId: f.role_id } } });
    if (query.q) {
      const q = query.q.trim();
      and.push({
        OR: [
          { fullName: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q.replace(/[^\d+]/g, '') || q } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    const where: Prisma.UserWhereInput = { AND: and };

    return this.db.tx(async (tx) => {
      const rows = await tx.user.findMany({
        where,
        include,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      // total cursor'siz shartda sanaladi
      const total =
        query.with_total === 'true' ? await tx.user.count({ where: { AND: and.filter((_, i) => i !== 1) } }) : undefined;
      return toPage(rows, limit, (u) => ({ ...view(u), photo_url: this.files.url(u.tenantId, u.photoFileId) }), total);
    });
  }

  options() {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const rows = await tx.user.findMany({
        // Kabinet foydalanuvchilari (rolsiz yoki faqat student/parent) xodim hisoblanmaydi
        where: { AND: [this.scope(auth), { isActive: true, roles: { some: { role: { code: { notIn: ['student', 'parent'] } } } } }] },
        select: { id: true, fullName: true },
        orderBy: { fullName: 'asc' },
        take: 500,
      });
      return rows.map((u) => ({ id: u.id, full_name: u.fullName }));
    });
  }

  get(id: string) {
    return this.db.tx(async (tx) => view(await this.find(tx, RequestContextStore.auth(), id)));
  }

  create(dto: CreateEmployeeDto) {
    const auth = RequestContextStore.auth();
    const phone = dto.phone ? requirePhone(dto.phone) : null;
    const email = dto.email?.toLowerCase() ?? null;
    if (!phone && !email) throw AppError.field('phone', 'REQUIRED', 'Telefon yoki email kiritilishi shart');
    const branchIds = this.resolveBranches(auth, dto.branch_ids ?? []);

    return this.db.tx(async (tx) => {
      await this.assertRolesAssignable(tx, auth, dto.role_ids);
      await this.assertBranchesExist(tx, branchIds);
      const user = await tx.user.create({
        data: {
          tenantId: auth.tenantId,
          fullName: dto.full_name.trim(),
          phone,
          email,
          passwordHash: await hashPassword(dto.password),
          roles: { create: dto.role_ids.map((roleId) => ({ tenantId: auth.tenantId, roleId })) },
          branches: { create: branchIds.map((branchId) => ({ tenantId: auth.tenantId, branchId })) },
        },
        include,
      });
      await this.audit.write(tx, auth.tenantId, {
        action: 'employee.created',
        entityType: 'user',
        entityId: user.id,
        newValue: view(user),
      });
      return view(user);
    });
  }

  update(id: string, dto: UpdateEmployeeDto) {
    const auth = RequestContextStore.auth();
    const phone = dto.phone === undefined ? undefined : requirePhone(dto.phone);
    const branchIds = dto.branch_ids === undefined ? undefined : this.resolveBranches(auth, dto.branch_ids);

    return this.db.tx(async (tx) => {
      const before = await this.find(tx, auth, id);
      if (dto.role_ids) {
        await this.assertRolesAssignable(tx, auth, dto.role_ids);
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({
          data: dto.role_ids.map((roleId) => ({ tenantId: auth.tenantId, userId: id, roleId })),
        });
      }
      if (branchIds) {
        await this.assertBranchesExist(tx, branchIds);
        await tx.userBranch.deleteMany({ where: { userId: id } });
        await tx.userBranch.createMany({
          data: branchIds.map((branchId) => ({ tenantId: auth.tenantId, userId: id, branchId })),
        });
      }
      const user = await tx.user.update({
        where: { id },
        data: {
          fullName: dto.full_name?.trim(),
          phone,
          email: dto.email?.toLowerCase(),
          passwordHash: dto.password ? await hashPassword(dto.password) : undefined,
        },
        include,
      });
      // Parol yoki rol o'zgarsa mavjud sessiyalar bekor qilinadi
      if (dto.password || dto.role_ids) await this.revokeSessions(tx, id);
      if (dto.role_ids) {
        await this.notifier.notify(tx, [id], {
          type: 'employee.roles_changed',
          data: { actor_name: auth.fullName, roles: user.roles.map((r) => r.role.name) },
        });
      }
      await this.audit.write(tx, auth.tenantId, {
        action: dto.role_ids ? 'employee.roles_changed' : 'employee.updated',
        entityType: 'user',
        entityId: id,
        oldValue: view(before),
        newValue: { ...view(user), password_changed: Boolean(dto.password) },
      });
      return view(user);
    });
  }

  /** Xodim o'chirilmaydi — deaktivatsiya qilinadi (TZ M1.4) */
  setActive(id: string, isActive: boolean) {
    const auth = RequestContextStore.auth();
    if (!isActive && id === auth.userId) throw AppError.conflict("O'zingizni deaktivatsiya qila olmaysiz", 'SELF_DEACTIVATE');
    return this.db.tx(async (tx) => {
      const before = await this.find(tx, auth, id);
      const user = await tx.user.update({ where: { id }, data: { isActive }, include });
      if (!isActive) await this.revokeSessions(tx, id);
      await this.audit.write(tx, auth.tenantId, {
        action: isActive ? 'employee.activated' : 'employee.deactivated',
        entityType: 'user',
        entityId: id,
        oldValue: { is_active: before.isActive },
        newValue: { is_active: isActive },
      });
      return view(user);
    });
  }

  /** Filial bilan cheklangan foydalanuvchi faqat o'z filial(lar)idagi xodimlarni ko'radi */
  private scope(auth: AuthContext): Prisma.UserWhereInput {
    const branchId = branchIdFilter(auth);
    // Kabinet foydalanuvchilari (o'quvchilar) xodim emas
    return { portalStudent: null, ...(branchId ? { branches: { some: { branchId } } } : {}) };
  }

  private async find(tx: Tx, auth: AuthContext, id: string): Promise<Employee> {
    const user = await tx.user.findFirst({ where: { AND: [{ id }, this.scope(auth)] }, include });
    if (!user) throw AppError.notFound('Xodim');
    return user;
  }

  private resolveBranches(auth: AuthContext, requested: string[]): string[] {
    const ids = [...new Set(requested)];
    if (auth.allowedBranchIds.length === 0) return ids;
    // Cheklangan foydalanuvchi "barcha filiallar" yoki begona filialni bera olmaydi
    if (ids.length === 0) throw AppError.field('branch_ids', 'REQUIRED', 'Kamida bitta filial tanlang');
    if (!ids.every((id) => canAccessBranch(auth, id))) throw AppError.forbidden("Bu filialga ruxsatingiz yo'q");
    return ids;
  }

  private async assertBranchesExist(tx: Tx, ids: string[]): Promise<void> {
    if (!ids.length) return;
    const found = await tx.branch.count({ where: { id: { in: ids } } });
    if (found !== ids.length) throw AppError.field('branch_ids', 'NOT_FOUND', 'Filial topilmadi');
  }

  private async assertRolesAssignable(tx: Tx, auth: AuthContext, roleIds: string[]): Promise<void> {
    const ids = [...new Set(roleIds)];
    const roles = await tx.role.findMany({ where: { id: { in: ids } }, include: { permissions: true } });
    if (roles.length !== ids.length) throw AppError.field('role_ids', 'NOT_FOUND', 'Rol topilmadi');
    assertCanGrant(
      auth,
      roles.flatMap((r) => r.permissions.map((p) => ({ code: p.permissionCode, scope: p.scope }))),
    );
  }

  private async revokeSessions(tx: Tx, userId: string): Promise<void> {
    await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}

import { Injectable } from '@nestjs/common';
import { ALL_PERMISSIONS, PERMISSION_GROUPS, PermissionCode, scopeCovers } from '../../common/auth/permissions.catalog';
import { AuditService } from '../../common/audit/audit.service';
import { AuthContext, RequestContextStore } from '../../common/context/request-context';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { AppError } from '../../common/http/app-error';
import { CreateRoleDto, RolePermissionDto, UpdateRoleDto } from './dto/roles.dto';

const KNOWN = new Set<string>(ALL_PERMISSIONS.map((p) => p.code));

const view = (role: {
  id: string;
  code: string;
  name: string;
  isSystem: boolean;
  permissions: { permissionCode: string; scope: string }[];
  _count?: { users: number };
}) => ({
  id: role.id,
  code: role.code,
  name: role.name,
  is_system: role.isSystem,
  users_count: role._count?.users,
  permissions: role.permissions
    .map((p) => ({ code: p.permissionCode, scope: p.scope }))
    .sort((a, b) => a.code.localeCompare(b.code)),
});

/** O'zida yo'q ruxsatni boshqaga berib bo'lmaydi (privilege escalation oldini olish) */
export function assertCanGrant(auth: AuthContext, permissions: { code: string; scope: string }[]): void {
  for (const p of permissions) {
    const held = auth.permissions[p.code as PermissionCode];
    if (!held || !scopeCovers(held, p.scope as 'own' | 'branch' | 'all')) {
      throw AppError.forbidden(`O'zingizda yo'q ruxsatni bera olmaysiz: ${p.code}`);
    }
  }
}

@Injectable()
export class RolesService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
  ) {}

  catalog() {
    return Object.entries(PERMISSION_GROUPS).map(([group, codes]) => ({ group, permissions: codes }));
  }

  list() {
    return this.db.tx(async (tx) => {
      const roles = await tx.role.findMany({
        orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }],
        include: { permissions: true, _count: { select: { users: true } } },
      });
      return roles.map(view);
    });
  }

  get(id: string) {
    return this.db.tx(async (tx) => view(await this.find(tx, id)));
  }

  create(dto: CreateRoleDto) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const source = dto.copy_from_role_id ? await this.find(tx, dto.copy_from_role_id) : null;
      const permissions = source?.permissions ?? [];
      assertCanGrant(auth, permissions.map((p) => ({ code: p.permissionCode, scope: p.scope })));
      const role = await tx.role.create({
        data: {
          tenantId: auth.tenantId,
          code: dto.code,
          name: dto.name,
          permissions: {
            create: permissions.map((p) => ({
              tenantId: auth.tenantId,
              permissionCode: p.permissionCode,
              scope: p.scope,
            })),
          },
        },
        include: { permissions: true },
      });
      await this.audit.write(tx, auth.tenantId, {
        action: 'role.created',
        entityType: 'role',
        entityId: role.id,
        newValue: view(role),
      });
      return view(role);
    });
  }

  rename(id: string, dto: UpdateRoleDto) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const before = await this.find(tx, id);
      const role = await tx.role.update({ where: { id }, data: { name: dto.name }, include: { permissions: true } });
      await this.audit.write(tx, auth.tenantId, {
        action: 'role.updated',
        entityType: 'role',
        entityId: id,
        oldValue: { name: before.name },
        newValue: { name: role.name },
      });
      return view(role);
    });
  }

  setPermissions(id: string, permissions: RolePermissionDto[]) {
    const auth = RequestContextStore.auth();
    const unknown = permissions.find((p) => !KNOWN.has(p.code));
    if (unknown) throw AppError.field('permissions', 'UNKNOWN_PERMISSION', `Noma'lum ruxsat: ${unknown.code}`);
    if (new Set(permissions.map((p) => p.code)).size !== permissions.length) {
      throw AppError.field('permissions', 'DUPLICATE', 'Ruxsatlar takrorlanmasligi kerak');
    }
    assertCanGrant(auth, permissions);

    return this.db.tx(async (tx) => {
      const before = await this.find(tx, id);
      // owner roli o'zgarmas: aks holda tenant o'zini tizimdan chiqarib qo'yishi mumkin
      if (before.code === 'owner') throw AppError.conflict("«owner» roli ruxsatlarini o'zgartirib bo'lmaydi", 'ROLE_LOCKED');

      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.rolePermission.createMany({
        data: permissions.map((p) => ({ tenantId: auth.tenantId, roleId: id, permissionCode: p.code, scope: p.scope })),
      });
      const after = await this.find(tx, id);
      await this.audit.write(tx, auth.tenantId, {
        action: 'role.permissions_changed',
        entityType: 'role',
        entityId: id,
        oldValue: view(before).permissions,
        newValue: view(after).permissions,
      });
      return view(after);
    });
  }

  private async find(tx: Tx, id: string) {
    const role = await tx.role.findFirst({ where: { id }, include: { permissions: true } });
    if (!role) throw AppError.notFound('Rol');
    return role;
  }
}

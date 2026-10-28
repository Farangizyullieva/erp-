import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AuthContext, RequestContextStore } from '../context/request-context';
import { PrismaService } from '../db/prisma.service';
import { AppError } from '../http/app-error';
import { IS_AUTHENTICATED, IS_PUBLIC, REQUIRED_PERMISSIONS, IS_PORTAL } from './decorators';
import { PermissionCode, Scope, widerScope } from './permissions.catalog';

export interface AccessTokenPayload {
  sub: string;
  tid: string;
}

/**
 * Global guard: token → foydalanuvchi konteksti → ruxsat tekshiruvi.
 * @Public / @Authenticated / @RequirePermission'dan hech biri qo'yilmagan endpoint rad etiladi (default deny).
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly db: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const auth = await this.authenticate(context.switchToHttp().getRequest<Request>());
    const store = RequestContextStore.get();
    if (!store) throw new Error('Request context middleware is not installed');
    store.auth = auth;

    // Kabinet foydalanuvchisi (faqat student/parent roli): xodimlar uchun endpointlarga — hatto "faqat login" talab
    // qiladiganlariga ham — kira olmaydi. Unga faqat @Portal() bilan belgilanganlari ochiq.
    const portalOnly = auth.roles.length > 0 && auth.roles.every((r) => r === 'student' || r === 'parent');
    if (portalOnly && !this.reflector.getAllAndOverride<boolean>(IS_PORTAL, targets)) throw AppError.forbidden();

    const required = this.reflector.getAllAndOverride<PermissionCode[] | undefined>(REQUIRED_PERMISSIONS, targets);
    if (required?.length) {
      if (required.some((code) => auth.permissions[code])) return true;
      throw AppError.forbidden();
    }
    if (this.reflector.getAllAndOverride<boolean>(IS_AUTHENTICATED, targets)) return true;
    throw AppError.forbidden("Endpoint uchun ruxsat belgilanmagan");
  }

  private async authenticate(req: Request): Promise<AuthContext> {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw AppError.unauthorized();
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(header.slice(7));
    } catch {
      throw AppError.unauthorized("Token yaroqsiz yoki muddati o'tgan", 'TOKEN_INVALID');
    }
    const auth = await loadAuthContext(this.db, payload.tid, payload.sub);
    if (!auth) throw AppError.unauthorized('Foydalanuvchi faol emas', 'TOKEN_INVALID');
    return auth;
  }
}

export async function loadAuthContext(db: PrismaService, tenantId: string, userId: string): Promise<AuthContext | null> {
  const user = await db.tx(
    (tx) =>
      tx.user.findFirst({
        where: { id: userId, isActive: true },
        select: {
          id: true,
          tenantId: true,
          fullName: true,
          branches: { select: { branchId: true } },
          roles: { select: { role: { select: { code: true, name: true, permissions: true } } } },
        },
      }),
    tenantId,
  );
  if (!user) return null;

  const permissions: Partial<Record<PermissionCode, Scope>> = {};
  for (const { role } of user.roles) {
    for (const p of role.permissions) {
      const code = p.permissionCode as PermissionCode;
      const held = permissions[code];
      permissions[code] = held ? widerScope(held, p.scope) : p.scope;
    }
  }
  return {
    userId: user.id,
    tenantId: user.tenantId,
    fullName: user.fullName,
    roles: user.roles.map((r) => r.role.code),
    roleNames: user.roles.map((r) => r.role.name),
    permissions,
    allowedBranchIds: user.branches.map((b) => b.branchId),
  };
}

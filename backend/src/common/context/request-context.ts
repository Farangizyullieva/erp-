import { AsyncLocalStorage } from 'node:async_hooks';
import type { PermissionCode, Scope } from '../auth/permissions.catalog';

export interface AuthContext {
  userId: string;
  tenantId: string;
  fullName: string;
  roles: string[];
  roleNames: string[];
  /** Har bir ruxsat uchun rollar bo'yicha eng keng scope */
  permissions: Partial<Record<PermissionCode, Scope>>;
  /** Bo'sh = barcha filiallar (TZ 3.3) */
  allowedBranchIds: string[];
}

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
  auth?: AuthContext;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const RequestContextStore = {
  run: <T>(ctx: RequestContext, fn: () => T): T => storage.run(ctx, fn),
  get: (): RequestContext | undefined => storage.getStore(),
  auth(): AuthContext {
    const auth = storage.getStore()?.auth;
    if (!auth) throw new Error('Auth context is not set');
    return auth;
  },
};

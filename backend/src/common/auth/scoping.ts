import type { AuthContext } from '../context/request-context';
import { AppError } from '../http/app-error';

/** Branch scoping (TZ 3.3): bo'sh ro'yxat = barcha filiallar → filtr qo'yilmaydi */
export function branchIdFilter(auth: AuthContext): { in: string[] } | undefined {
  return auth.allowedBranchIds.length ? { in: auth.allowedBranchIds } : undefined;
}

export function canAccessBranch(auth: AuthContext, branchId: string): boolean {
  return auth.allowedBranchIds.length === 0 || auth.allowedBranchIds.includes(branchId);
}

/** Ruxsat etilmagan filial mavjudligini oshkor qilmaslik uchun 404 */
export function assertBranchAccess(auth: AuthContext, branchId: string): void {
  if (!canAccessBranch(auth, branchId)) throw AppError.notFound('Filial');
}

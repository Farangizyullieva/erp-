import { applyDecorators, createParamDecorator, SetMetadata } from '@nestjs/common';
import { AuthContext, RequestContextStore } from '../context/request-context';
import type { PermissionCode } from './permissions.catalog';

export const IS_PUBLIC = 'access:public';
export const IS_AUTHENTICATED = 'access:authenticated';
export const REQUIRED_PERMISSIONS = 'access:permissions';
export const IS_PORTAL = 'access:portal';

/** Tokensiz ochiq endpoint (login, health, webhook) */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Faqat login talab qilinadi, alohida ruxsat emas (masalan /auth/me) */
export const Authenticated = () => SetMetadata(IS_AUTHENTICATED, true);
/** Sanab o'tilgan ruxsatlardan kamida bittasi bo'lishi shart (TZ 3.4) */
export const RequirePermission = (...codes: PermissionCode[]) => SetMetadata(REQUIRED_PERMISSIONS, codes);

/**
 * O'quvchi kabineti (student/parent roli) ham kira oladigan endpoint. Faqat login talab qilinadi;
 * kabinet foydalanuvchisi BOSHQA hech bir endpointga kira olmaydi (qarang: AccessGuard).
 */
export const Portal = () => applyDecorators(SetMetadata(IS_AUTHENTICATED, true), SetMetadata(IS_PORTAL, true));

export const CurrentUser = createParamDecorator((): AuthContext => RequestContextStore.auth());

import { clearRefreshCookie, getRefreshCookie, postJson, rejectCrossSite } from '@/lib/session-cookie';

export async function POST(req: Request): Promise<Response> {
  // Begona sayt foydalanuvchini majburan tizimdan chiqarib yubora olmaydi
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const token = await getRefreshCookie();
  if (token) await postJson('/auth/logout', { refresh_token: token }).catch(() => undefined);
  await clearRefreshCookie();
  return new Response(null, { status: 204 });
}

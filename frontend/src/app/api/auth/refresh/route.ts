import { clearRefreshCookie, forwardTokens, getRefreshCookie, postJson, rejectCrossSite } from '@/lib/session-cookie';

export async function POST(req: Request): Promise<Response> {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const token = await getRefreshCookie();
  if (!token) return Response.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  const upstream = await postJson('/auth/refresh', { refresh_token: token });
  if (upstream.status === 401) await clearRefreshCookie();
  return forwardTokens(upstream);
}

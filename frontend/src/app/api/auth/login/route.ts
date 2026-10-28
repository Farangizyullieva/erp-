import { forwardTokens, postJson, rejectCrossSite } from '@/lib/session-cookie';

export async function POST(req: Request): Promise<Response> {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const body = (await req.json().catch(() => ({}))) as { login?: string; password?: string; totp_code?: string };
  return forwardTokens(await postJson('/auth/login', { login: body.login, password: body.password, totp_code: body.totp_code || undefined }, req));
}

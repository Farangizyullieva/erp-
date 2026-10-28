import { cookies } from 'next/headers';

export const API_URL = process.env.API_URL ?? 'http://localhost:3001/api/v1';
const NAME = 'educrm_rt';

// httpOnly + SameSite=Strict: JS o'qiy olmaydi, CSRF'dan himoyalangan (TZ 11.3)
export async function setRefreshCookie(token: string): Promise<void> {
  (await cookies()).set(NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/auth',
    maxAge: 30 * 24 * 60 * 60,
  });
}

export async function getRefreshCookie(): Promise<string | undefined> {
  return (await cookies()).get(NAME)?.value;
}

export async function clearRefreshCookie(): Promise<void> {
  (await cookies()).set(NAME, '', { httpOnly: true, sameSite: 'strict', path: '/api/auth', maxAge: 0 });
}

interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/** API javobidan refresh token'ni cookie'ga olib, brauzerga faqat access token qaytaradi */
export async function forwardTokens(upstream: Response): Promise<Response> {
  const body = (await upstream.json().catch(() => null)) as { data?: Tokens; error?: unknown } | null;
  if (!upstream.ok || !body?.data) {
    return Response.json(body ?? { error: { code: 'ERROR', message: 'Xatolik yuz berdi' } }, {
      status: upstream.ok ? 502 : upstream.status,
    });
  }
  await setRefreshCookie(body.data.refresh_token);
  return Response.json({ access_token: body.data.access_token, expires_in: body.data.expires_in });
}

/**
 * CSRF himoyasi (cookie'dagi SameSite=Strict ustiga ikkinchi qatlam): refresh cookie bilan ishlaydigan
 * route'lar faqat o'z saytimizdan kelgan so'rovni qabul qiladi. Brauzer Origin / Sec-Fetch-Site
 * sarlavhalarini o'zi qo'yadi — begona sahifadagi skript ularni soxtalashtira olmaydi.
 */
export function rejectCrossSite(req: Request): Response | null {
  const site = req.headers.get('sec-fetch-site');
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const crossSite = (site !== null && site !== 'same-origin' && site !== 'none') || (origin !== null && new URL(origin).host !== host);
  return crossSite ? Response.json({ error: { code: 'CROSS_SITE_REQUEST', message: "So'rov rad etildi" } }, { status: 403 }) : null;
}

/** API'ga ulanib bo'lmasa ham route handler 500 emas, tushunarli xato qaytaradi */
export async function postJson(path: string, body: unknown, req?: Request): Promise<Response> {
  const forwardedFor = req?.headers.get('x-forwarded-for');
  try {
    return await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Rate limit haqiqiy mijoz IP'si bo'yicha ishlashi uchun
        ...(forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {}),
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    return Response.json(
      { error: { code: 'API_UNAVAILABLE', message: "Server vaqtincha ishlamayapti. Birozdan keyin urinib ko'ring" } },
      { status: 503 },
    );
  }
}

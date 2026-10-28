import { NextResponse, type NextRequest } from 'next/server';

const apiOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1').origin;
  } catch {
    return '';
  }
})();
const dev = process.env.NODE_ENV !== 'production';

/**
 * Har bir sahifa javobiga xavfsizlik sarlavhalarini qo'yadi.
 * CSP (XSS'ga qarshi asosiy to'siq): skriptlar faqat shu so'rov uchun yaratilgan nonce bilan ishlaydi —
 * sahifaga qandaydir yo'l bilan kiritilgan begona <script> bajarilmaydi. Next o'z skriptlariga nonce'ni
 * `x-nonce` sarlavhasidan oladi (layout.tsx), shuning uchun sahifalar dinamik render qilinadi.
 */
export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = [
    "default-src 'self'",
    // Dev rejimida Next HMR uchun eval va websocket kerak
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // style atributlari (grafiklar, dinamik kenglik) uchun inline uslub; skriptlarga bu ta'sir qilmaydi
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    // Profil rasmlari API'dan imzolangan havola orqali keladi
    `img-src 'self' data: blob: ${apiOrigin}`,
    `connect-src 'self' ${apiOrigin}${dev ? ' ws: wss:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Clickjacking: sahifani boshqa sayt ichiga (iframe) joylab bo'lmaydi
    "frame-ancestors 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  if (!dev) response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return response;
}

export const config = {
  // Statik fayllar va API route'lardan tashqari hamma sahifalar
  matcher: [{ source: '/((?!api|_next/static|_next/image|favicon.ico).*)', missing: [{ type: 'header', key: 'next-router-prefetch' }] }],
};

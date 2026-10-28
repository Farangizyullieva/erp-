import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AppError } from '../http/app-error';

// SSRF himoyasi: server foydalanuvchi bergan URL'ga murojaat qilishidan oldin (webhook, fayl yuklab olish)
// manzil ichki tarmoqqa (localhost, 10.x, 169.254.169.254 metadata va h.k.) ko'rsatmasligini tekshiradi.

function isPrivateV4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 || // "this", private, loopback, multicast/reserved
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, bulut metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateV4(ip);
  const v6 = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isPrivateV4(mapped[1] as string);
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith('ff');
}

/**
 * URL tashqi (ommaviy) manzilga ko'rsatishini kafolatlaydi va tekshirilgan IP'ni qaytaradi.
 * So'rov aynan shu IP'ga yuborilishi kerak — aks holda DNS rebinding tekshiruvni chetlab o'tadi.
 * Redirect'lar avtomatik kuzatilmasligi (`redirect: 'manual'`) va har biri qayta tekshirilishi shart.
 */
export async function assertPublicUrl(raw: string): Promise<{ url: URL; address: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw AppError.field('url', 'INVALID_URL', "URL noto'g'ri");
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw AppError.field('url', 'INVALID_URL', 'Faqat http(s) manzillarga ruxsat beriladi');
  if (url.username || url.password) throw AppError.field('url', 'INVALID_URL', "URL'da login/parol bo'lmasligi kerak");

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  // Bitta bo'lsa ham ichki manzil qaytsa — rad etiladi
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw AppError.field('url', 'FORBIDDEN_URL', 'Bu manzilga murojaat qilishga ruxsat berilmagan');
  }
  return { url, address: addresses[0] as string };
}

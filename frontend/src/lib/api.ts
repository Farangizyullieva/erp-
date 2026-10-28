const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

export interface ApiErrorDetail {
  field: string;
  code: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ApiErrorDetail[] = [],
    readonly requestId?: string,
  ) {
    super(message);
  }

  fieldErrors(): Record<string, string> {
    return Object.fromEntries(this.details.map((d) => [d.field, d.message]));
  }
}

// Access token faqat xotirada; refresh token httpOnly cookie'da (route handler'lar orqali)
let accessToken: string | null = null;
let refreshing: Promise<string | null> | null = null;

export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};

/** Bir vaqtda faqat bitta refresh: parallel so'rovlar rotation'da "reuse" deb topilib, sessiyani yopib qo'yadi */
export function refreshAccessToken(): Promise<string | null> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST' })
    .then(async (res) => {
      accessToken = res.ok ? ((await res.json()) as { access_token: string }).access_token : null;
      return accessToken;
    })
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function toError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as {
    error?: { code: string; message: string; details?: ApiErrorDetail[]; request_id?: string };
  } | null;
  const e = body?.error;
  return new ApiError(res.status, e?.code ?? 'ERROR', e?.message ?? 'Xatolik yuz berdi', e?.details, e?.request_id);
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const send = (): Promise<Response> =>
    fetch(`${API_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

  let res = await send();
  if (res.status === 401 && (await refreshAccessToken())) res = await send();
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return ((await res.json()) as { data: T }).data;
}

/** Fayl yuklash (multipart). Content-Type'ni brauzer o'zi qo'yadi (boundary bilan) */
export async function apiUpload<T>(path: string, file: File): Promise<T> {
  const send = (): Promise<Response> => {
    const body = new FormData();
    body.append('file', file);
    return fetch(`${API_URL}${path}`, { method: 'POST', headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}, body });
  };
  let res = await send();
  if (res.status === 401 && (await refreshAccessToken())) res = await send();
  if (!res.ok) throw await toError(res);
  return ((await res.json()) as { data: T }).data;
}

export interface Paged<T> {
  data: T[];
  meta: { next_cursor: string | null; total?: number };
}

export async function apiPage<T>(path: string): Promise<Paged<T>> {
  const send = (): Promise<Response> =>
    fetch(`${API_URL}${path}`, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
  let res = await send();
  if (res.status === 401 && (await refreshAccessToken())) res = await send();
  if (!res.ok) throw await toError(res);
  return (await res.json()) as Paged<T>;
}

'use client';

import { ArrowLeft, CalendarCheck, Eye, EyeOff, GraduationCap, ShieldCheck, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, ErrorNote, Field, IconButton } from '@/components/ui';
import { PANELS, panelOf, type Panel } from '@/components/portal-gate';
import { api, setAccessToken } from '@/lib/api';
import type { Me } from '@/lib/auth';
import { t } from '@/lib/i18n';

const POINTS = [
  { icon: GraduationCap, text: "O'quvchi, guruh va jadval — bitta joyda" },
  { icon: CalendarCheck, text: 'Davomat telefondan, bir necha soniyada' },
  { icon: Wallet, text: "To'lov va qarzdorlik avtomatik hisoblanadi" },
];

/** Admin paneli va o'qituvchi paneli kirish sahifasi. Boshqa panel akkaunti bu yerdan kirmaydi — o'z sahifasiga yo'naltiriladi */
export function StaffLogin({ panel }: { panel: Exclude<Panel, 'portal'> }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [wrongPanel, setWrongPanel] = useState<Panel | null>(null);
  // 2FA yoqilgan akkauntda parol to'g'ri bo'lgach ikkinchi qadam — bir martalik kod
  const [credentials, setCredentials] = useState<{ login: string; password: string } | null>(null);

  async function submit(payload: { login: string; password: string; totp_code?: string }) {
    setPending(true);
    setError(null);
    setWrongPanel(null);
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const body = (await res.json()) as { access_token?: string; error?: { code?: string; message?: string } };
      if (body.error?.code === 'TOTP_REQUIRED') {
        setCredentials({ login: payload.login, password: payload.password });
        return;
      }
      if (!res.ok || !body.access_token) {
        setError(body.error?.message ?? t("Kirib bo'lmadi. Qayta urinib ko'ring"));
        return;
      }
      setAccessToken(body.access_token);
      const actual = panelOf(await api<Me>('/auth/me'));
      if (actual !== panel) {
        await fetch('/api/auth/logout', { method: 'POST' });
        setAccessToken(null);
        setWrongPanel(actual);
        return;
      }
      router.replace(PANELS[panel].home);
    } catch {
      setError(t("Server bilan bog'lanib bo'lmadi. Internetni tekshirib, qayta urinib ko'ring"));
    } finally {
      setPending(false);
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (credentials) void submit({ ...credentials, totp_code: String(form.get('totp_code') ?? '').replace(/\D/g, '') });
    else void submit({ login: String(form.get('login') ?? ''), password: String(form.get('password') ?? '') });
  }

  return (
    <main data-theme="light" className="grid min-h-dvh bg-canvas lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <section className="hidden flex-col justify-between bg-hero p-12 text-white lg:flex">
        <Link href="/" className="w-fit rounded text-xl font-semibold tracking-tight focus-visible:outline-white">
          Edu<span className="text-hero-accent">CRM</span>
        </Link>
        <div>
          <h2 className="max-w-md text-[32px] font-semibold leading-tight tracking-tight">{t("O'quv markazingizning barcha ishlari bitta tizimda")}</h2>
          <ul className="mt-8 space-y-4">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-[15px] text-white/90">
                <span className="grid size-9 place-items-center rounded-lg bg-white/12">
                  <Icon className="size-[18px]" aria-hidden />
                </span>
                {t(text)}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-white/50">© {new Date().getFullYear()} EduCRM</p>
      </section>

      <section className="grid place-items-center p-6">
        <form onSubmit={onSubmit} className="w-full max-w-sm animate-in space-y-5" key={credentials ? 'totp' : 'password'}>
          <Link href="/" className="mb-6 block w-fit text-lg font-semibold text-hero lg:hidden">
            EduCRM
          </Link>
          {credentials ? (
            <>
              <div>
                <span className="mb-4 grid size-11 place-items-center rounded-xl bg-brand-soft text-brand">
                  <ShieldCheck className="size-6" aria-hidden />
                </span>
                <h1 className="text-2xl font-semibold tracking-tight">{t('Tasdiqlash kodi')}</h1>
                <p className="mt-1.5 text-sm text-muted">{t('Autentifikator ilovasidagi 6 xonali kodni kiriting')}</p>
              </div>
              <Field
                label="Kod"
                name="totp_code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]{6,7}"
                maxLength={7}
                placeholder="000000"
                required
                autoFocus
                className="text-center text-lg tracking-[0.4em] tabular-nums"
              />
              {error && <ErrorNote>{error}</ErrorNote>}
              <Button type="submit" size="lg" className="w-full" loading={pending}>
                Tasdiqlash
              </Button>
              <button
                type="button"
                onClick={() => {
                  setCredentials(null);
                  setError(null);
                }}
                className="mx-auto flex items-center gap-1.5 rounded text-sm text-muted hover:text-ink"
              >
                <ArrowLeft className="size-4" aria-hidden /> {t('Boshqa akkaunt bilan kirish')}
              </button>
            </>
          ) : (
            <>
              <div>
                <p className="mb-2 inline-flex rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand-strong">{t(PANELS[panel].name)}</p>
                <h1 className="text-2xl font-semibold tracking-tight">{t('Xush kelibsiz')}</h1>
                <p className="mt-1.5 text-sm text-muted">{t('Davom etish uchun hisobingizga kiring')}</p>
              </div>
              <Field label="Telefon yoki email" name="login" autoComplete="username" inputMode="email" placeholder="+998 90 123-45-67" required autoFocus />
              <Field
                label="Parol"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                trailing={
                  <IconButton label={showPassword ? 'Parolni yashirish' : "Parolni ko'rsatish"} icon={showPassword ? EyeOff : Eye} onClick={() => setShowPassword((v) => !v)} className="size-8" />
                }
              />
              {error && <ErrorNote>{error}</ErrorNote>}
              {wrongPanel && (
                <ErrorNote>
                  {t('Bu sahifa — {panel}. Sizning akkauntingiz boshqa panelga tegishli:', { panel: t(PANELS[panel].name) })}{' '}
                  <Link href={PANELS[wrongPanel].login} className="font-semibold underline">
                    {t('{panel} — kirish', { panel: t(PANELS[wrongPanel].name) })}
                  </Link>
                </ErrorNote>
              )}
              <Button type="submit" size="lg" className="w-full" loading={pending}>
                Kirish
              </Button>
              <p className="text-center text-xs text-muted">{t('Parolni unutdingizmi? Tashkilot administratoriga murojaat qiling.')}</p>
              <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 border-t border-line pt-4 text-sm">
                {(['staff', 'teacher', 'portal'] as const)
                  .filter((p) => p !== panel)
                  .map((p) => (
                    <Link key={p} href={PANELS[p].login} className="font-medium text-brand-strong hover:underline">
                      {t('{panel} — kirish', { panel: t(PANELS[p].name) })}
                    </Link>
                  ))}
              </div>
            </>
          )}
        </form>
      </section>
    </main>
  );
}

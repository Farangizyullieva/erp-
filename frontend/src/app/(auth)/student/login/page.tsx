'use client';

import { Eye, EyeOff, GraduationCap } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { PANELS, panelOf, STUDENT_HOME, type Panel } from '@/components/portal-gate';
import { Button, ErrorNote, Field, IconButton } from '@/components/ui';
import { api, setAccessToken } from '@/lib/api';
import type { Me } from '@/lib/auth';
import { t } from '@/lib/i18n';

// O'quvchilar uchun alohida kirish sahifasi (/student/login): telefon raqami va markaz bergan 6 xonali parol.
// Xodim akkaunti bu yerdan kira olmaydi — o'z sahifasiga yo'naltiriladi.
export default function StudentLoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [wrongPanel, setWrongPanel] = useState<Panel | null>(null);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    setWrongPanel(null);
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: String(form.get('login') ?? ''), password: String(form.get('password') ?? '') }) });
      const body = (await res.json()) as { access_token?: string; error?: { code?: string; message?: string } };
      if (!res.ok || !body.access_token) {
        // Ikki bosqichli tasdiqlash faqat xodimlarda bo'ladi
        if (body.error?.code === 'TOTP_REQUIRED') setWrongPanel('staff');
        else setError(body.error?.message ?? t("Kirib bo'lmadi. Qayta urinib ko'ring"));
        return;
      }
      setAccessToken(body.access_token);
      const actual = panelOf(await api<Me>('/auth/me'));
      if (actual !== 'portal') {
        await fetch('/api/auth/logout', { method: 'POST' });
        setAccessToken(null);
        setWrongPanel(actual);
        return;
      }
      router.replace(STUDENT_HOME);
    } catch {
      setError(t("Server bilan bog'lanib bo'lmadi. Internetni tekshirib, qayta urinib ko'ring"));
    } finally {
      setPending(false);
    }
  }

  return (
    <main data-theme="light" className="grid min-h-dvh place-items-center bg-canvas p-5">
      <div className="w-full max-w-sm animate-in">
        <div className="rounded-t-3xl bg-brand px-6 pb-8 pt-7 text-center text-white">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-white/15">
            <GraduationCap className="size-8" aria-hidden />
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">{t("O'quvchi kabineti")}</h1>
          <p className="mt-1.5 text-sm text-white/80">{t("Jadval, davomat va to'lovlaringiz bir joyda")}</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 rounded-b-3xl border border-t-0 border-line bg-surface px-6 pb-6 pt-6 shadow-card">
          <Field label="Telefon raqamingiz" name="login" type="tel" autoComplete="username" inputMode="tel" placeholder="+998 90 123-45-67" required autoFocus />
          <Field
            label="Parol"
            name="password"
            type={showPassword ? 'text' : 'password'}
            inputMode="numeric"
            autoComplete="current-password"
            placeholder="••••••"
            required
            hint="O'quv markaz bergan 6 xonali raqam"
            trailing={<IconButton label={showPassword ? 'Parolni yashirish' : "Parolni ko'rsatish"} icon={showPassword ? EyeOff : Eye} onClick={() => setShowPassword((v) => !v)} className="size-8" />}
          />
          {error && <ErrorNote>{error}</ErrorNote>}
          {wrongPanel && (
            <ErrorNote>
              {t("Bu sahifa o'quvchilar uchun. Sizning akkauntingiz boshqa panelga tegishli:")}{' '}
              <Link href={PANELS[wrongPanel].login} className="font-semibold underline">
                {t('{panel} — kirish', { panel: t(PANELS[wrongPanel].name) })}
              </Link>
            </ErrorNote>
          )}
          <Button type="submit" size="lg" className="w-full" loading={pending}>
            Kirish
          </Button>
          <p className="text-center text-xs text-muted">{t("Parolni unutdingizmi? O'quv markaz administratoridan yangisini so'rang.")}</p>
        </form>
        <p className="mt-5 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm">
          <Link href={PANELS.teacher.login} className="font-medium text-brand-strong hover:underline">
            {t('{panel} — kirish', { panel: t(PANELS.teacher.name) })}
          </Link>
          <Link href={PANELS.staff.login} className="font-medium text-brand-strong hover:underline">
            {t('{panel} — kirish', { panel: t(PANELS.staff.name) })}
          </Link>
        </p>
      </div>
    </main>
  );
}

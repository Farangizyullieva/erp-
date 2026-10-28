'use client';

import clsx from 'clsx';
import { CalendarDays, ClipboardCheck, GraduationCap, House, LogOut, Moon, Sun, Users, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Avatar, ConfirmDialog } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/teacher', label: 'Bosh sahifa', icon: House },
  { href: '/teacher/schedule', label: 'Jadval', icon: CalendarDays },
  { href: '/teacher/groups', label: 'Guruhlarim', icon: Users },
  { href: '/teacher/attendance', label: 'Davomat', icon: ClipboardCheck },
];

// O'qituvchi paneli: admin panelidan alohida, faqat o'qituvchiga kerakli 4 bo'lim
export function TeacherShell({ children }: { children: ReactNode }) {
  const { me, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const pathname = usePathname();
  const [leaving, setLeaving] = useState(false);
  const active = (href: string) => (href === '/teacher' ? pathname === href : pathname.startsWith(href));

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-15 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <Link href="/teacher" className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-full bg-success text-white">
              <GraduationCap className="size-5" aria-hidden />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold">{me.tenant_name}</span>
              <span className="block text-xs text-muted">{t("O'qituvchi paneli")}</span>
            </span>
          </Link>
          <nav aria-label={t("O'qituvchi menyusi")} className="ml-6 hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} aria-current={active(item.href) ? 'page' : undefined} className={clsx('flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors', active(item.href) ? 'bg-success-soft text-success' : 'text-muted hover:bg-canvas hover:text-ink')}>
                <item.icon className="size-4" aria-hidden />
                {t(item.label)}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" onClick={toggle} aria-label={t(theme === 'dark' ? "Yorug' rejim" : "Qorong'i rejim")} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-canvas hover:text-ink">
              {theme === 'dark' ? <Sun className="size-[18px]" aria-hidden /> : <Moon className="size-[18px]" aria-hidden />}
            </button>
            <span className="hidden items-center gap-2 pl-2 sm:flex">
              <Avatar name={me.full_name} src={me.photo_url} size="sm" />
              <span className="text-sm font-medium">{me.full_name}</span>
            </span>
            <button type="button" onClick={() => setLeaving(true)} aria-label={t('Chiqish')} title={t('Chiqish')} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger">
              <LogOut className="size-[18px]" aria-hidden />
            </button>
          </div>
        </div>
        {/* Telefonda menyu pastda — bosh barmoq bilan oson */}
      </header>
      <main className="mx-auto max-w-7xl px-4 pb-24 pt-6 sm:px-6 md:pb-10">{children}</main>
      <nav aria-label={t("O'qituvchi menyusi")} className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-surface md:hidden">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} className={clsx('flex flex-col items-center gap-1 py-2 text-[11px] font-medium', active(item.href) ? 'text-success' : 'text-muted')}>
            <item.icon className="size-5" aria-hidden />
            {t(item.label)}
          </Link>
        ))}
      </nav>
      {leaving && <ConfirmDialog title="Tizimdan chiqish" message="Paneldan chiqmoqchimisiz?" confirmLabel="Chiqish" onConfirm={() => void logout()} onClose={() => setLeaving(false)} />}
    </div>
  );
}

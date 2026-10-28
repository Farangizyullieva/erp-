'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Bell, BellOff, GraduationCap, ShieldCheck, type LucideIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { timeAgo } from '@/lib/activity';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';

interface Notification {
  id: string;
  type: string;
  data: Record<string, unknown>;
  read: boolean;
  created_at: string;
}

interface View {
  icon: LucideIcon;
  title: string;
  body: string;
  href: string | null;
}

/** Bildirishnoma matni klientda, foydalanuvchi tilida yig'iladi (backend faqat type + data saqlaydi) */
function describe(n: Notification): View {
  const d = n.data;
  switch (n.type) {
    case 'student.assigned':
      return {
        icon: GraduationCap,
        title: t("Sizga o'quvchi biriktirildi"),
        body: `${String(d.student_name)} · ${String(d.actor_name)}`,
        href: `/students/${String(d.student_id)}`,
      };
    case 'employee.roles_changed':
      return {
        icon: ShieldCheck,
        title: t("Rollaringiz o'zgartirildi"),
        body: `${(d.roles as string[] | undefined)?.join(', ') ?? ''} · ${String(d.actor_name)}`,
        href: null,
      };
    default:
      return { icon: Bell, title: n.type, body: '', href: null };
  }
}

export function NotificationBell({ unread }: { unread: number }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const list = useQuery({ queryKey: ['inbox', 'notifications'], queryFn: () => api<Notification[]>('/notifications'), enabled: open });
  const markRead = useMutation({
    mutationFn: (ids?: string[]) => api<void>('/notifications/read', { method: 'POST', body: ids ? { ids } : {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inbox'] }),
  });

  useEffect(() => {
    if (!open) return;
    const handler = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', handler);
    };
  }, [open]);

  const openItem = (n: Notification, href: string | null) => {
    if (!n.read) markRead.mutate([n.id]);
    if (href) {
      setOpen(false);
      router.push(href);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread ? t("Bildirishnomalar: {n} ta o'qilmagan", { n: unread }) : t('Bildirishnomalar')}
        title={t('Bildirishnomalar')}
        className="relative grid size-10 place-items-center rounded-lg text-ink/70 hover:bg-canvas hover:text-ink"
      >
        <Bell className="size-5" aria-hidden />
        {unread > 0 && (
          <span className="absolute right-0.5 top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label={t('Bildirishnomalar')} className="absolute right-0 top-full mt-1.5 w-[min(92vw,23rem)] animate-in overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
          <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">{t('Bildirishnomalar')}</h2>
            {unread > 0 && (
              <button type="button" onClick={() => markRead.mutate(undefined)} className="text-[13px] font-medium text-brand hover:text-brand-strong">
                {t("Hammasini o'qilgan qilish")}
              </button>
            )}
          </header>
          {list.isPending ? (
            <div className="space-y-2 p-4" role="status">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-canvas" />
              ))}
            </div>
          ) : list.isError ? (
            <p className="p-4 text-sm text-danger">{list.error.message}</p>
          ) : list.data.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
              <BellOff className="mb-1 size-6 text-muted" aria-hidden />
              <p className="text-sm font-medium">{t("Hozircha bildirishnoma yo'q")}</p>
              <p className="text-[13px] text-muted">{t("Sizga o'quvchi biriktirilganda yoki rolingiz o'zgarganda shu yerda ko'rinadi.")}</p>
            </div>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
              {list.data.map((n) => {
                const view = describe(n);
                return (
                  <li key={n.id}>
                    <button type="button" onClick={() => openItem(n, view.href)} className={clsx('flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-canvas/70', !n.read && 'bg-brand-soft/40')}>
                      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-strong">
                        <view.icon className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={clsx('block text-[13px]', n.read ? 'font-medium' : 'font-semibold')}>{view.title}</span>
                        <span className="block truncate text-[13px] text-muted">{view.body}</span>
                        <span className="mt-0.5 block text-xs text-muted">{timeAgo(n.created_at)}</span>
                      </span>
                      {!n.read && <span className="mt-2 size-2 shrink-0 rounded-full bg-brand" aria-label={t("O'qilmagan")} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

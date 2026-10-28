'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { BellRing, CalendarClock, MessageSquareText, Receipt, Send, UserX, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useToast } from '@/components/toast';
import { EmptyState, ErrorNote, PageHeader, Panel, StatusPill, TableSkeleton, Tag, td, th } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { t } from '@/lib/i18n';

interface Status {
  configured: boolean;
  connected: boolean;
  bot_username: string | null;
  linked_contacts: number;
  weekly_report_enabled: boolean;
  payment_reminder_enabled: boolean;
  absence_notice_enabled: boolean;
  receipt_enabled: boolean;
}

type SettingKey = 'payment_reminder_enabled' | 'absence_notice_enabled' | 'receipt_enabled';
const AUTOMATIONS: { key: SettingKey; icon: LucideIcon; title: string; text: string }[] = [
  { key: 'payment_reminder_enabled', icon: BellRing, title: "To'lov eslatmasi", text: "Yangi o'quv oyi boshlanishidan 3 kun oldin, balansi yetmaydigan o'quvchilarning ota-onasiga eslatma yuboriladi." },
  { key: 'absence_notice_enabled', icon: UserX, title: 'Darsga kelmadi xabari', text: "O'quvchi bugungi darsga sababsiz kelmagan deb belgilansa, 10 daqiqadan keyin ota-onasiga xabar boradi. Shu vaqt ichida belgi tuzatilsa xabar ketmaydi." },
  { key: 'receipt_enabled', icon: Receipt, title: "To'lov cheki", text: "To'lov qabul qilinganda ota-onaga summa, sana va chek raqami yozilgan xabar yuboriladi." },
];

interface LogEntry {
  id: string;
  kind: string;
  status: 'queued' | 'sent' | 'failed';
  error: string | null;
  body: string;
  recipient: string | null;
  student: { id: string; full_name: string } | null;
  created_at: string;
  sent_at: string | null;
}

const KIND: Record<string, string> = { manual: "Qo'lda", weekly_report: 'Haftalik hisobot', debt_reminder: 'Qarz eslatmasi', payment_reminder: "To'lov eslatmasi", absence: 'Darsga kelmadi', receipt: "To'lov cheki", system: 'Tizim' };
const DELIVERY = { queued: { label: 'Navbatda', tone: 'info' }, sent: { label: 'Yuborildi', tone: 'success' }, failed: { label: 'Yuborilmadi', tone: 'danger' } } as const;

// Telegram xabarnomalari (TZ M8): bot holati, haftalik hisobot sozlamasi va yuborilgan xabarlar jurnali
export default function TelegramPage() {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['messaging', 'status'], queryFn: () => api<Status>('/messaging/status') });
  const log = useQuery({ queryKey: ['messaging', 'log'], queryFn: () => api<LogEntry[]>('/messaging/log'), refetchInterval: 10_000 });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api<{ weekly_report_enabled: boolean }>('/messaging/weekly-report', { method: 'PUT', body: { enabled } }),
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: ['messaging', 'status'] });
      toast.success(r.weekly_report_enabled ? 'Haftalik hisobot yoqildi' : "Haftalik hisobot o'chirildi");
    },
    onError: (e) => toast.error(e.message),
  });

  const setting = useMutation({
    mutationFn: (body: Partial<Record<SettingKey, boolean>>) => api<Status>('/messaging/settings', { method: 'PUT', body }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['messaging', 'status'] });
      toast.success('Sozlama saqlandi');
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader title="Telegram xabarlar" description="Ota-onalarga Telegram orqali xabar va haftalik hisobot yuborish" />
      {status.isPending ? (
        <Panel>
          <TableSkeleton rows={2} />
        </Panel>
      ) : status.isError ? (
        <ErrorNote onRetry={() => void status.refetch()}>{status.error.message}</ErrorNote>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel className="p-5">
            <div className="flex items-start gap-4">
              <span className={clsx('grid size-11 shrink-0 place-items-center rounded-xl', status.data.connected ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning')}>
                <Send className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">{t('Telegram bot')}</h2>
                  <StatusPill tone={status.data.connected ? 'success' : 'warning'}>{status.data.connected ? 'Ulangan' : status.data.configured ? "Token noto'g'ri" : 'Ulanmagan'}</StatusPill>
                </div>
                {status.data.connected ? (
                  <p className="mt-1.5 text-sm text-muted">
                    <a href={`https://t.me/${status.data.bot_username}`} target="_blank" rel="noreferrer" className="font-medium text-brand hover:text-brand-strong">
                      @{status.data.bot_username}
                    </a>{' '}
                    · {t('{n} ta aloqa shaxsi ulangan', { n: status.data.linked_contacts })}
                  </p>
                ) : (
                  <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-sm leading-relaxed text-muted">
                    <li>{t("Telegram'da @BotFather orqali bot yarating va tokenini oling.")}</li>
                    <li>
                      {t('Tokenni serverdagi sozlamalar fayliga yozing:')} <code className="rounded bg-canvas px-1.5 py-0.5 font-mono text-xs text-ink">TELEGRAM_BOT_TOKEN</code>
                    </li>
                    <li>{t('Serverni qayta ishga tushiring — holat «Ulangan» ga o\'zgaradi.')}</li>
                  </ol>
                )}
                {status.data.connected && (
                  <p className="mt-3 text-[13px] leading-relaxed text-muted">{t("Ota-onani ulash: o'quvchi kartochkasida aloqa shaxsi yonidagi «Telegram ulash» tugmasini bosing va chiqqan havolani unga yuboring.")}</p>
                )}
              </div>
            </div>
          </Panel>

          <Panel className="p-5">
            <div className="flex items-start gap-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                <CalendarClock className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-semibold">{t('Haftalik hisobot')}</h2>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={status.data.weekly_report_enabled}
                    aria-label={t('Haftalik hisobot')}
                    disabled={!can('automation.manage') || toggle.isPending}
                    onClick={() => toggle.mutate(!status.data.weekly_report_enabled)}
                    className={clsx('relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50', status.data.weekly_report_enabled ? 'bg-brand' : 'bg-line')}
                  >
                    <span className={clsx('absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-card transition-transform', status.data.weekly_report_enabled && 'translate-x-5')} />
                  </button>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{t("Har yakshanba soat 18:00 da ulangan ota-onalarga farzandi bo'yicha qisqa hisobot avtomatik yuboriladi.")}</p>
                <p className="mt-2 rounded-lg bg-canvas/70 px-3 py-2 text-[13px] leading-relaxed text-muted">
                  {t("Hisobotda: shu haftadagi davomat (nechta darsdan nechtasiga kelgani), o'quvchi holati va balans — so'mda va darslar sonida.")}
                </p>
              </div>
            </div>
          </Panel>

          <Panel className="lg:col-span-2">
            <header className="border-b border-line px-5 py-3.5">
              <h2 className="font-semibold">{t('Avtomatik xabarlar')}</h2>
              <p className="mt-0.5 text-[13px] text-muted">{t("Tizim o'zi yuboradi — faqat botga ulangan ota-onalarga boradi.")}</p>
            </header>
            <ul className="divide-y divide-line">
              {AUTOMATIONS.map((a) => {
                const on = status.data[a.key];
                return (
                  <li key={a.key} className="flex items-start gap-4 px-5 py-4">
                    <span className={clsx('grid size-10 shrink-0 place-items-center rounded-lg', on ? 'bg-brand-soft text-brand' : 'bg-canvas text-muted')}>
                      <a.icon className="size-5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{t(a.title)}</p>
                      <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{t(a.text)}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={t(a.title)}
                      disabled={!can('automation.manage') || setting.isPending}
                      onClick={() => setting.mutate({ [a.key]: !on })}
                      className={clsx('relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50', on ? 'bg-brand' : 'bg-line')}
                    >
                      <span className={clsx('absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-card transition-transform', on && 'translate-x-5')} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      )}

      <Panel className="mt-4 overflow-hidden">
        <h2 className="border-b border-line px-5 py-3.5 font-semibold">{t('Xabarlar jurnali')}</h2>
        {log.isPending ? (
          <TableSkeleton rows={3} />
        ) : log.isError ? (
          <div className="p-4">
            <ErrorNote onRetry={() => void log.refetch()}>{log.error.message}</ErrorNote>
          </div>
        ) : log.data.length === 0 ? (
          <EmptyState icon={MessageSquareText} title="Hali xabar yuborilmagan" hint="O'quvchi kartochkasidagi «Xabar yuborish» tugmasi orqali birinchi xabarni yuboring." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line bg-canvas/50">
                <tr>
                  {['Vaqt', 'Kimga', "O'quvchi", 'Turi', 'Matn', 'Holat'].map((h) => (
                    <th key={h} className={th}>
                      {t(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {log.data.map((m) => (
                  <tr key={m.id} className="hover:bg-canvas/40">
                    <td className={`${td} whitespace-nowrap tabular-nums text-muted`}>{formatDateTime(m.sent_at ?? m.created_at)}</td>
                    <td className={`${td} whitespace-nowrap font-medium`}>{m.recipient ?? '—'}</td>
                    <td className={`${td} whitespace-nowrap`}>
                      {m.student ? (
                        <Link href={`/students/${m.student.id}`} className="text-brand hover:text-brand-strong">
                          {m.student.full_name}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={td}>
                      <Tag>{KIND[m.kind] ?? m.kind}</Tag>
                    </td>
                    <td className={`${td} max-w-xs`}>
                      <p className="truncate text-muted" title={m.body}>
                        {m.body.split('\n')[0]}
                      </p>
                    </td>
                    <td className={td}>
                      <StatusPill tone={DELIVERY[m.status].tone}>{DELIVERY[m.status].label}</StatusPill>
                      {m.error && m.status !== 'sent' && <p className="mt-1 max-w-52 text-xs text-muted">{m.error}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

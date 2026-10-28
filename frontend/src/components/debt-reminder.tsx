'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import Link from 'next/link';
import { useToast } from '@/components/toast';
import { Button, ErrorNote, Modal } from '@/components/ui';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { t } from '@/lib/i18n';

interface Result {
  debtors: number;
  will_receive: number;
  not_linked: number;
  recently_reminded: number;
  total_debt: number;
  sample: string;
  bot_configured: boolean;
  queued: number;
}

/**
 * Qarzdorlarga Telegram orqali "qarzingizni to'lang" eslatmasi. Avval nechta odamga borishi ko'rsatiladi, keyin tasdiqlanadi.
 * `studentIds` berilmasa — barcha qarzdorlarga.
 */
export function DebtReminderDialog({ studentIds, name, onClose }: { studentIds?: string[]; name?: string; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const body = studentIds ? { student_ids: studentIds } : {};
  const preview = useQuery({ queryKey: ['debt-reminders', 'preview', studentIds ?? 'all'], queryFn: () => api<Result>('/messaging/debt-reminders', { method: 'POST', body: { ...body, dry_run: true } }), gcTime: 0 });
  const send = useMutation({
    mutationFn: () => api<Result>('/messaging/debt-reminders', { method: 'POST', body }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['messaging'] });
      toast.success(t('{n} ta eslatma navbatga qo\'yildi', { n: result.queued }));
      onClose();
    },
  });
  const p = preview.data;
  const rows: [string, number, string][] = p
    ? [
        ['Eslatma oladi', p.will_receive, 'text-success'],
        ["Telegram'ga ulanmagan", p.not_linked, p.not_linked ? 'text-warning' : 'text-muted'],
        ['Oxirgi 24 soatda yuborilgan', p.recently_reminded, 'text-muted'],
      ]
    : [];

  return (
    <Modal
      title="Qarz eslatmasi"
      description={name ? t("{name} ota-onasiga Telegram orqali yuboriladi", { name }) : "Barcha qarzdorlarning ota-onalariga Telegram orqali yuboriladi"}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button onClick={() => send.mutate()} loading={send.isPending} disabled={!p || p.will_receive === 0 || !p.bot_configured}>
            <Send className="size-4" aria-hidden /> {p && p.will_receive > 0 ? t('{n} kishiga yuborish', { n: p.will_receive }) : t('Yuborish')}
          </Button>
        </>
      }
    >
      {preview.isPending ? (
        <div className="h-48 animate-pulse rounded-lg bg-canvas" role="status" />
      ) : preview.isError ? (
        <ErrorNote onRetry={() => void preview.refetch()}>{preview.error.message}</ErrorNote>
      ) : (
        p && (
          <div className="space-y-4">
            {!p.bot_configured && <ErrorNote>{t('Telegram bot ulanmagan. Administrator bot tokenini sozlashi kerak')}</ErrorNote>}
            <p className="text-sm">
              {t('Qarzdorlar: {n} kishi, jami {sum}', { n: p.debtors, sum: formatMoney(p.total_debt) })}
            </p>
            <dl className="divide-y divide-line rounded-lg border border-line">
              {rows.map(([label, value, tone]) => (
                <div key={label} className="flex items-center justify-between px-3.5 py-2.5 text-sm">
                  <dt className="text-ink/80">{t(label)}</dt>
                  <dd className={`font-semibold tabular-nums ${tone}`}>{value}</dd>
                </div>
              ))}
            </dl>
            {p.not_linked > 0 && (
              <p className="text-xs text-muted">
                {t("Ulanmaganlarga xabar bormaydi: avval o'quvchi kartochkasida ota-onaga Telegram havolasini bering.")}
              </p>
            )}
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted">{t('Xabar namunasi')}</p>
              <p className="whitespace-pre-line rounded-lg bg-canvas px-3.5 py-3 text-sm">{p.sample}</p>
            </div>
            <p className="text-xs text-muted">
              {t('Xabarlar 09:00–21:00 oralig\'ida yuboriladi.')}{' '}
              <Link href="/communication/telegram" className="font-medium text-brand-strong hover:underline">
                {t('Yuborilganlar jurnali')}
              </Link>
            </p>
            {send.isError && <ErrorNote>{send.error.message}</ErrorNote>}
          </div>
        )
      )}
    </Modal>
  );
}

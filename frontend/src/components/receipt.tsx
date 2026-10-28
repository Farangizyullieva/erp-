'use client';

import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { Button, ErrorNote, Modal } from '@/components/ui';
import { METHODS } from '@/lib/academic';
import { api } from '@/lib/api';
import { formatDateTime, formatMoney, formatPhone, studentNo } from '@/lib/format';
import { t } from '@/lib/i18n';

interface Receipt {
  id: string;
  number: string;
  occurred_at: string;
  amount: number;
  method: string | null;
  comment: string | null;
  center: string;
  branch: { name: string; address: string | null; phone: string | null };
  student: { id: string; number: number; full_name: string };
  groups: string[];
  cashier: string | null;
}

/**
 * To'lov cheki (kvitansiya): ekranda ko'rsatiladi va chop etiladi. Chop etishda sahifada faqat chek qoladi
 * (globals.css → @media print, `.receipt-print`).
 */
export function ReceiptDialog({ paymentId, note, onClose }: { paymentId: string; note?: string; onClose: () => void }) {
  const receipt = useQuery({ queryKey: ['payments', 'receipt', paymentId], queryFn: () => api<Receipt>(`/payments/${paymentId}/receipt`) });
  const r = receipt.data;
  const rows: [string, string][] = r
    ? [
        ["O'quvchi", r.student.full_name],
        ['ID', studentNo(r.student.number)],
        ...(r.groups.length ? ([['Guruh', r.groups.join(', ')]] as [string, string][]) : []),
        ['Sana', formatDateTime(r.occurred_at)],
        ["To'lov usuli", t(METHODS[r.method ?? ''] ?? '—')],
        ...(r.comment ? ([['Izoh', r.comment]] as [string, string][]) : []),
        ...(r.cashier ? ([['Qabul qildi', r.cashier]] as [string, string][]) : []),
      ]
    : [];

  return (
    <Modal
      title="To'lov cheki"
      description={note}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Yopish
          </Button>
          <Button onClick={() => window.print()} disabled={!r}>
            <Printer className="size-4" aria-hidden /> Chop etish
          </Button>
        </>
      }
    >
      {receipt.isPending ? (
        <div className="h-72 animate-pulse rounded-lg bg-canvas" role="status" />
      ) : receipt.isError ? (
        <ErrorNote onRetry={() => void receipt.refetch()}>{receipt.error.message}</ErrorNote>
      ) : (
        r && (
          <div className="receipt-print rounded-xl border border-dashed border-line bg-canvas/40 px-5 py-5">
            <div className="text-center">
              <p className="text-base font-semibold">{r.center}</p>
              <p className="mt-0.5 text-xs text-muted">
                {[r.branch.name, r.branch.address, r.branch.phone && formatPhone(r.branch.phone)].filter(Boolean).join(' · ')}
              </p>
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-widest text-muted">{t("To'lov cheki")}</p>
              <p className="font-mono text-sm tabular-nums">№ {r.number}</p>
            </div>
            <dl className="mt-4 space-y-2 border-y border-dashed border-line py-3.5 text-sm">
              {rows.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <dt className="shrink-0 text-muted">{t(label)}</dt>
                  <dd className="text-right font-medium tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-3.5 flex items-baseline justify-between gap-4">
              <span className="text-sm font-medium">{t("To'landi")}</span>
              <span className="text-2xl font-semibold tabular-nums tracking-tight">{formatMoney(r.amount)}</span>
            </div>
            <p className="mt-4 text-center text-xs text-muted">{t("To'lovingiz uchun rahmat!")}</p>
          </div>
        )
      )}
    </Modal>
  );
}

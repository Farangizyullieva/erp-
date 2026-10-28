'use client';

import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, Banknote, Plus, Printer, Send, TrendingUp, Wallet, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PayStudentPicker } from '@/components/academic';
import { useNewParam } from '@/lib/use-new-param';
import { DebtReminderDialog } from '@/components/debt-reminder';
import { ReceiptDialog } from '@/components/receipt';
import { Avatar, Button, EmptyState, IconButton, ErrorNote, PageHeader, Panel, SearchInput, Segmented, StatusPill, TableSkeleton, Tabs, Tag, td, th } from '@/components/ui';
import { METHODS, todayIso } from '@/lib/academic';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime, formatMoney, formatPhone, studentNo } from '@/lib/format';
import { t } from '@/lib/i18n';
import { STATUS, type StudentStatus } from '@/lib/students';

interface Summary {
  month_revenue: number;
  month_payments: number;
  today_revenue: number;
  today_payments: number;
  total_debt: number;
  debtors: number;
  average_payment: number;
  active_students: number;
  paid_students: number;
}

interface Payment {
  id: string;
  receipt_number: string;
  occurred_at: string;
  amount: number;
  method: string | null;
  comment: string | null;
  student: { id: string; number: number; full_name: string; branch: string };
  created_by: string | null;
}

interface BalanceRow {
  id: string;
  number: number;
  full_name: string;
  phone: string | null;
  branch: string;
  status: StudentStatus;
  groups: string[];
  balance: number;
  monthly_price: number;
  months: number | null;
  next_payment_date: string | null;
  paid_this_month: number;
  last_payment_at: string | null;
  telegram_linked: boolean;
}

type Period = 'today' | 'month' | 'all';
type Filter = 'all' | 'paid' | 'unpaid' | 'debtors';

function Stat({ icon: Icon, label, value, caption, tone, active, onClick }: { icon: LucideIcon; label: string; value: string; caption: string; tone: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={clsx('rounded-xl border bg-surface p-4 text-left shadow-card transition-colors hover:border-brand/50', active ? 'border-brand ring-2 ring-brand/20' : 'border-line')}>
      <span className={`grid size-10 place-items-center rounded-lg ${tone}`}>
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="mt-3 text-sm text-ink/80">{t(label)}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted">{caption}</p>
    </button>
  );
}

// Moliya (TZ M6.10): ko'rsatkichlar bosilganda tegishli ro'yxat ochiladi — to'lovlar yoki o'quvchilar kesimi
export default function FinancePage() {
  const { can } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<'payments' | 'students'>('payments');
  const [period, setPeriod] = useState<Period>('month');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  // 'all' — barcha qarzdorlarga; aks holda bitta o'quvchi
  const [reminding, setReminding] = useState<'all' | { id: string; name: string } | null>(null);
  const canRemind = can('message.bulk_send');
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useNewParam(() => can('payment.create') && setPaying(true));

  const today = todayIso();
  const summary = useQuery({ queryKey: ['finance', 'summary'], queryFn: () => api<Summary>('/finance/summary'), enabled: can('finance.view_amounts') });
  const from = period === 'today' ? today : period === 'month' ? `${today.slice(0, 8)}01` : '';
  const payments = useQuery({ queryKey: ['payments', period], queryFn: () => api<Payment[]>(`/payments${from ? `?from=${from}` : ''}`), enabled: tab === 'payments' && can('payment.view') });
  const balances = useQuery({
    queryKey: ['finance', 'balances', filter, q],
    queryFn: () => api<BalanceRow[]>(`/finance/balances?filter=${filter}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
    enabled: tab === 'students' && can('ledger.view'),
  });
  const show = (nextTab: 'payments' | 'students', next: { period?: Period; filter?: Filter }) => {
    setTab(nextTab);
    if (next.period) setPeriod(next.period);
    if (next.filter) setFilter(next.filter);
  };
  const s = summary.data;

  return (
    <>
      <PageHeader
        title="Moliya"
        description="Tushumlar, qarzdorlik va o'quvchilar balansi"
        action={
          can('payment.create') && (
            <Button onClick={() => setPaying(true)}>
              <Plus className="size-4" aria-hidden /> To'lov qabul qilish
            </Button>
          )
        }
      />

      {can('finance.view_amounts') &&
        (summary.isError ? (
          <ErrorNote onRetry={() => void summary.refetch()}>{summary.error.message}</ErrorNote>
        ) : !s ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" role="status">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-[138px] animate-pulse rounded-xl bg-surface" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat icon={Wallet} label="Shu oydagi tushum" value={formatMoney(s.month_revenue)} caption={t("{n} ta to'lov", { n: s.month_payments })} tone="bg-brand-soft text-brand" active={tab === 'payments' && period === 'month'} onClick={() => show('payments', { period: 'month' })} />
            <Stat icon={Banknote} label="Bugungi to'lovlar" value={formatMoney(s.today_revenue)} caption={t("{n} ta to'lov", { n: s.today_payments })} tone="bg-success-soft text-success" active={tab === 'payments' && period === 'today'} onClick={() => show('payments', { period: 'today' })} />
            <Stat icon={AlertTriangle} label="Umumiy qarzdorlik" value={formatMoney(s.total_debt)} caption={t('{n} ta qarzdor', { n: s.debtors })} tone="bg-danger-soft text-danger" active={tab === 'students' && filter === 'debtors'} onClick={() => show('students', { filter: 'debtors' })} />
            <Stat icon={TrendingUp} label="Shu oyda to'laganlar" value={`${s.paid_students} / ${s.active_students}`} caption={t("O'rtacha to'lov: {sum}", { sum: formatMoney(s.average_payment) })} tone="bg-warning-soft text-warning" active={tab === 'students' && filter === 'paid'} onClick={() => show('students', { filter: 'paid' })} />
          </div>
        ))}

      <div className="mt-5">
        <Tabs tabs={[{ id: 'payments', label: "To'lovlar" }, { id: 'students', label: "O'quvchilar balansi" }]} value={tab} onChange={setTab} />
      </div>

      {tab === 'payments' ? (
        <>
          <div className="mt-4">
            <Segmented label="Davr" value={period} onChange={setPeriod} options={[{ id: 'today', label: 'Bugun' }, { id: 'month', label: 'Shu oy' }, { id: 'all', label: 'Hammasi' }]} />
          </div>
          <Panel className="mt-4 overflow-hidden">
            {payments.isPending ? (
              <TableSkeleton />
            ) : payments.isError ? (
              <div className="p-4">
                <ErrorNote onRetry={() => void payments.refetch()}>{payments.error.message}</ErrorNote>
              </div>
            ) : payments.data.length === 0 ? (
              <EmptyState icon={Banknote} title="Bu davrda to'lov yo'q" hint="«To'lov qabul qilish» tugmasi orqali birinchi to'lovni kiriting." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-line bg-canvas/50">
                    <tr>
                      {['Chek №', 'Vaqt', "To'lovchi", 'Filial', 'Usul', 'Kim qabul qildi', 'Izoh'].map((h) => (
                        <th key={h} className={th}>
                          {t(h)}
                        </th>
                      ))}
                      <th className={`${th} text-right`}>{t('Summa')}</th>
                      <th className={th} aria-label={t('Chek')} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {payments.data.map((p) => (
                      <tr key={p.id} onClick={() => router.push(`/students/${p.student.id}`)} className="group cursor-pointer hover:bg-canvas/40">
                        <td className={`${td} whitespace-nowrap font-mono text-xs tabular-nums text-muted`}>{p.receipt_number}</td>
                        <td className={`${td} whitespace-nowrap tabular-nums text-muted`}>{formatDateTime(p.occurred_at)}</td>
                        <td className={td}>
                          <span className="flex items-center gap-3">
                            <Avatar name={p.student.full_name} size="sm" />
                            <span className="min-w-0">
                              <Link href={`/students/${p.student.id}`} onClick={(e) => e.stopPropagation()} className="block font-medium group-hover:text-brand-strong">
                                {p.student.full_name}
                              </Link>
                              <span className="text-xs tabular-nums text-muted">{studentNo(p.student.number)}</span>
                            </span>
                          </span>
                        </td>
                        <td className={`${td} text-muted`}>{p.student.branch}</td>
                        <td className={td}>
                          <Tag>{t(METHODS[p.method ?? ''] ?? '—')}</Tag>
                        </td>
                        <td className={`${td} text-muted`}>{p.created_by ?? '—'}</td>
                        <td className={`${td} max-w-48 truncate text-muted`}>{p.comment ?? '—'}</td>
                        <td className={`${td} whitespace-nowrap text-right font-medium tabular-nums text-success`}>+{formatMoney(p.amount)}</td>
                        <td className={`${td} w-12`} onClick={(e) => e.stopPropagation()}>
                          <IconButton label="Chekni ochish" icon={Printer} onClick={() => setReceipt(p.id)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-line bg-canvas/50">
                      <td colSpan={7} className={`${td} font-medium`}>
                        {t("Jami: {n} ta to'lov", { n: payments.data.length })}
                      </td>
                      <td className={`${td} whitespace-nowrap text-right font-semibold tabular-nums`}>{formatMoney(payments.data.reduce((sum, p) => sum + p.amount, 0))}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Panel>
        </>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <Segmented
              label="Filtr"
              value={filter}
              onChange={setFilter}
              options={[{ id: 'all', label: 'Hammasi' }, { id: 'paid', label: "To'laganlar" }, { id: 'unpaid', label: "To'lamaganlar" }, { id: 'debtors', label: 'Qarzdorlar' }]}
            />
            <SearchInput value={search} onChange={setSearch} placeholder="Ism yoki ID" />
            {canRemind && filter === 'debtors' && (balances.data?.length ?? 0) > 0 && (
              <div className="ml-auto">
                <Button onClick={() => setReminding('all')}>
                  <Send className="size-4" aria-hidden /> Qarzdorlarga eslatma yuborish
                </Button>
              </div>
            )}
          </div>
          <p className="mt-2 text-xs text-muted">
            {filter === 'paid' ? t("Shu oyda kamida bitta to'lov qilgan o'quvchilar") : filter === 'unpaid' ? t("O'qiyotgan, lekin shu oyda hali to'lov qilmagan o'quvchilar") : filter === 'debtors' ? t('Balansi manfiy — markazga qarzi bor o\'quvchilar') : t("Barcha o'quvchilar (arxivdagilarsiz)")}
          </p>
          <Panel className="mt-3 overflow-hidden">
            {balances.isPending ? (
              <TableSkeleton />
            ) : balances.isError ? (
              <div className="p-4">
                <ErrorNote onRetry={() => void balances.refetch()}>{balances.error.message}</ErrorNote>
              </div>
            ) : balances.data.length === 0 ? (
              <EmptyState icon={Wallet} title="Bu shartga mos o'quvchi yo'q" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-line bg-canvas/50">
                    <tr>
                      {["O'quvchi", 'Telefon', 'Guruh', 'Holat', "Oxirgi to'lov", "Keyingi to'lov"].map((h) => (
                        <th key={h} className={th}>
                          {t(h)}
                        </th>
                      ))}
                      <th className={`${th} text-right`}>{t("Shu oyda to'ladi")}</th>
                      <th className={`${th} text-right`}>{t('Balans')}</th>
                      {canRemind && <th className={th} aria-label={t('Amallar')} />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {balances.data.map((r) => (
                      <tr key={r.id} onClick={() => router.push(`/students/${r.id}`)} className="group cursor-pointer hover:bg-canvas/40">
                        <td className={td}>
                          <span className="flex items-center gap-3">
                            <Avatar name={r.full_name} size="sm" />
                            <span className="min-w-0">
                              <Link href={`/students/${r.id}`} onClick={(e) => e.stopPropagation()} className="block font-medium group-hover:text-brand-strong">
                                {r.full_name}
                              </Link>
                              <span className="text-xs tabular-nums text-muted">{studentNo(r.number)}</span>
                            </span>
                          </span>
                        </td>
                        <td className={`${td} whitespace-nowrap tabular-nums`}>{formatPhone(r.phone)}</td>
                        <td className={`${td} text-muted`}>{r.groups.join(', ') || '—'}</td>
                        <td className={td}>
                          <StatusPill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</StatusPill>
                        </td>
                        <td className={`${td} whitespace-nowrap tabular-nums text-muted`}>{r.last_payment_at ? formatDateTime(r.last_payment_at).slice(0, 10) : t("To'lamagan")}</td>
                        <td className={`${td} whitespace-nowrap tabular-nums text-muted`}>{r.next_payment_date ? formatDate(r.next_payment_date) : '—'}</td>
                        <td className={`${td} whitespace-nowrap text-right tabular-nums ${r.paid_this_month ? 'text-success' : 'text-muted'}`}>{r.paid_this_month ? formatMoney(r.paid_this_month) : '—'}</td>
                        <td className={`${td} whitespace-nowrap text-right tabular-nums`}>
                          <span className={clsx('font-medium', r.balance < 0 && 'text-danger')}>{formatMoney(r.balance)}</span>
                          {r.months !== null && r.months > 0 && (
                            <span className="block text-xs text-muted">{r.balance < 0 ? t('{n} oylik abonement qarzi', { n: r.months }) : t('yana {n} oyga yetadi', { n: r.months })}</span>
                          )}
                        </td>
                        {canRemind && (
                          <td className={`${td} w-12`} onClick={(e) => e.stopPropagation()}>
                            {r.balance < 0 && (
                              <IconButton label={r.telegram_linked ? 'Qarz eslatmasini yuborish' : "Ota-onasi Telegram'ga ulanmagan"} disabled={!r.telegram_linked} icon={Send} onClick={() => setReminding({ id: r.id, name: r.full_name })} className="disabled:opacity-35" />
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
      {reminding && <DebtReminderDialog studentIds={reminding === 'all' ? undefined : [reminding.id]} name={reminding === 'all' ? undefined : reminding.name} onClose={() => setReminding(null)} />}
      {paying && <PayStudentPicker onClose={() => setPaying(false)} />}
      {receipt && <ReceiptDialog paymentId={receipt} onClose={() => setReceipt(null)} />}
    </>
  );
}

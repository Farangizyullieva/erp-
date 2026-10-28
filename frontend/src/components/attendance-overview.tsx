'use client';

import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, CalendarCheck, ClipboardCheck, UserX, Users, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { usePanel } from '@/components/portal-gate';
import { Avatar, EmptyState, ErrorNote, PageHeader, Panel, SearchInput, Select, TableSkeleton, td, th } from '@/components/ui';
import { addDays, todayIso, unitLabel, type Ref, type StudyUnit } from '@/lib/academic';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, studentNo } from '@/lib/format';
import { t } from '@/lib/i18n';

interface Row {
  id: string;
  number: number;
  full_name: string;
  branch: string;
  photo_url: string | null;
  groups: { id: string; number: number; name: string }[];
  present: number;
  late: number;
  absent_excused: number;
  absent_unexcused: number;
  marked: number;
  rate: number | null;
}

interface Overview {
  from: string;
  to: string;
  summary: { students: number; marked: number; absent: number; rate: number | null; at_risk: number };
  rows: Row[];
}

type Period = 'month' | '30' | '90';
type Only = 'all' | 'risk' | 'absent';

function Stat({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: string; tone: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
      <span className={`grid size-10 shrink-0 place-items-center rounded-lg ${tone}`}>
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm text-ink/80">{t(label)}</p>
        <p className="text-xl font-semibold tabular-nums tracking-tight">{value}</p>
      </div>
    </div>
  );
}

// Barcha o'quvchilar davomati: kim nechta darsga kelgan, kechikkan, kelmagan. Eng past davomat tepada.
export function AttendanceOverview({ switcher }: { switcher: ReactNode }) {
  const { can } = useAuth();
  const router = useRouter();
  // O'qituvchi panelida o'quvchi kartochkasi yo'q — qatorlar bosilmaydi
  const linked = usePanel() !== 'teacher';
  const [period, setPeriod] = useState<Period>('month');
  const [branchId, setBranchId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [only, setOnly] = useState<Only>('all');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const today = todayIso();
  const from = period === 'month' ? `${today.slice(0, 8)}01` : addDays(today, -Number(period));
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<Ref[]>('/branches'), enabled: can('branch.view') });
  const units = useQuery({ queryKey: ['study-units', 'list', '', ''], queryFn: () => api<StudyUnit[]>('/study-units?') });
  const params = new URLSearchParams({ from, to: today });
  if (branchId) params.set('branch_id', branchId);
  if (unitId) params.set('study_unit_id', unitId);
  if (q) params.set('q', q);
  const overview = useQuery({ queryKey: ['attendance', 'overview', from, branchId, unitId, q], queryFn: () => api<Overview>(`/attendance/overview?${params.toString()}`) });

  const data = overview.data;
  const rows = (data?.rows ?? []).filter((r) => (only === 'risk' ? r.rate !== null && r.rate < 70 : only === 'absent' ? r.absent_unexcused > 0 : true));
  const visibleUnits = (units.data ?? []).filter((u) => !branchId || u.branch.id === branchId);

  return (
    <>
      <PageHeader title="Davomat" description={data ? t("Barcha o'quvchilar · {from} – {to}", { from: formatDate(data.from), to: formatDate(data.to) }) : "Barcha o'quvchilar davomati"} action={switcher} />

      {data && (
        <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat icon={Users} label="O'quvchilar" value={String(data.summary.students)} tone="bg-brand-soft text-brand" />
          <Stat icon={CalendarCheck} label="O'rtacha davomat" value={data.summary.rate === null ? '—' : `${data.summary.rate}%`} tone="bg-success-soft text-success" />
          <Stat icon={UserX} label="Qoldirilgan darslar" value={String(data.summary.absent)} tone="bg-warning-soft text-warning" />
          <Stat icon={AlertTriangle} label="Davomati 70% dan past" value={String(data.summary.at_risk)} tone="bg-danger-soft text-danger" />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchInput value={search} onChange={setSearch} placeholder="Ism yoki ID" />
        <Select aria-label={t('Davr')} value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
          <option value="month">{t('Shu oy')}</option>
          <option value="30">{t('Oxirgi {n} kun', { n: 30 })}</option>
          <option value="90">{t('Oxirgi {n} kun', { n: 90 })}</option>
        </Select>
        {(branches.data?.length ?? 0) > 1 && (
          <Select
            aria-label={t('Filial')}
            value={branchId}
            onChange={(e) => {
              setBranchId(e.target.value);
              setUnitId('');
            }}
          >
            <option value="">{t('Barcha filiallar')}</option>
            {branches.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
        <Select aria-label={t('Guruh')} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
          <option value="">{t('Barcha guruhlar')}</option>
          {visibleUnits.map((u) => (
            <option key={u.id} value={u.id}>
              {unitLabel(u)}
            </option>
          ))}
        </Select>
        <Select aria-label={t("Ko'rsatish")} value={only} onChange={(e) => setOnly(e.target.value as Only)}>
          <option value="all">{t('Hammasi')}</option>
          <option value="risk">{t('Davomati 70% dan past')}</option>
          <option value="absent">{t('Sababsiz qoldirganlar')}</option>
        </Select>
      </div>

      <Panel className={clsx('overflow-hidden transition-opacity', overview.isFetching && !overview.isPending && 'opacity-70')}>
        {overview.isPending ? (
          <TableSkeleton rows={8} />
        ) : overview.isError ? (
          <div className="p-4">
            <ErrorNote onRetry={() => void overview.refetch()}>{overview.error.message}</ErrorNote>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="Bu shartga mos o'quvchi yo'q" hint="Davr yoki filtrlarni o'zgartirib ko'ring." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line bg-canvas/50">
                <tr>
                  {["O'quvchi", 'Guruh', 'Filial'].map((h) => (
                    <th key={h} className={th}>
                      {t(h)}
                    </th>
                  ))}
                  {['Keldi', 'Kechikdi', 'Sababli', 'Sababsiz'].map((h) => (
                    <th key={h} className={`${th} text-right`}>
                      {t(h)}
                    </th>
                  ))}
                  <th className={`${th} min-w-44`}>{t('Davomat')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id} onClick={linked ? () => router.push(`/students/${r.id}`) : undefined} className={clsx('group', linked && 'cursor-pointer hover:bg-canvas/40')}>
                    <td className={td}>
                      <span className="flex items-center gap-3">
                        <Avatar name={r.full_name} src={r.photo_url} size="sm" />
                        <span className="min-w-0">
                          {linked ? (
                            <Link href={`/students/${r.id}`} onClick={(e) => e.stopPropagation()} className="block font-medium group-hover:text-brand-strong">
                              {r.full_name}
                            </Link>
                          ) : (
                            <span className="block font-medium">{r.full_name}</span>
                          )}
                          <span className="text-xs tabular-nums text-muted">{studentNo(r.number)}</span>
                        </span>
                      </span>
                    </td>
                    <td className={`${td} text-muted`}>{r.groups.map(unitLabel).join(', ')}</td>
                    <td className={`${td} text-muted`}>{r.branch}</td>
                    <td className={`${td} text-right tabular-nums`}>{r.present}</td>
                    <td className={`${td} text-right tabular-nums ${r.late ? 'text-warning' : 'text-muted'}`}>{r.late}</td>
                    <td className={`${td} text-right tabular-nums text-muted`}>{r.absent_excused}</td>
                    <td className={`${td} text-right tabular-nums ${r.absent_unexcused ? 'font-medium text-danger' : 'text-muted'}`}>{r.absent_unexcused}</td>
                    <td className={td}>
                      {r.rate === null ? (
                        <span className="text-xs text-muted">{t('Hali belgilanmagan')}</span>
                      ) : (
                        <div className="flex items-center gap-2.5">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-canvas" aria-hidden>
                            <div className={clsx('h-full rounded-full', r.rate < 70 ? 'bg-danger' : r.rate < 85 ? 'bg-warning' : 'bg-success')} style={{ width: `${r.rate}%` }} />
                          </div>
                          <span className={clsx('w-10 text-right text-sm font-semibold tabular-nums', r.rate < 70 ? 'text-danger' : r.rate < 85 ? 'text-warning' : 'text-success')}>{r.rate}%</span>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="mt-3 text-xs text-muted">{linked ? t("Eng past davomat tepada turadi. O'quvchini bosib kartochkasidagi davomat kalendarini oching.") : t('Eng past davomat tepada turadi.')}</p>
    </>
  );
}

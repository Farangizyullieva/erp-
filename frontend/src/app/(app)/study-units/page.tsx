'use client';

import { useQuery } from '@tanstack/react-query';
import { Plus, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { UnitForm } from '@/components/academic';
import { Button, EmptyState, ErrorNote, PageHeader, Panel, SearchInput, Select, StatusPill, TableSkeleton, td, th } from '@/components/ui';
import { subjectColor, UNIT_STATUS, WEEKDAYS_SHORT, type StudyUnit, type UnitStatus } from '@/lib/academic';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatMoney } from '@/lib/format';
import { t } from '@/lib/i18n';

// O'quv birliklari (TZ M4.1): guruhlar ro'yxati
export default function StudyUnitsPage() {
  const { can } = useAuth();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  const units = useQuery({ queryKey: ['study-units', 'list', q, status], queryFn: () => api<StudyUnit[]>(`/study-units?${params.toString()}`) });
  const addButton = can('study_unit.create') && (
    <Button onClick={() => setCreating(true)}>
      <Plus className="size-4" aria-hidden /> Guruh qo'shish
    </Button>
  );

  return (
    <>
      <PageHeader title="O'quv birliklari" description="Guruhlar, ularning jadvali, o'qituvchisi va to'ldirilishi" action={addButton} />
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchInput value={search} onChange={setSearch} placeholder="Guruh raqami yoki nomi" />
        <Select aria-label={t('Holat')} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('Barcha holatlar')}</option>
          {(Object.keys(UNIT_STATUS) as UnitStatus[]).map((s) => (
            <option key={s} value={s}>
              {t(UNIT_STATUS[s].label)}
            </option>
          ))}
        </Select>
      </div>

      <Panel className="overflow-hidden">
        {units.isPending ? (
          <TableSkeleton />
        ) : units.isError ? (
          <div className="p-4">
            <ErrorNote onRetry={() => void units.refetch()}>{units.error.message}</ErrorNote>
          </div>
        ) : units.data.length === 0 ? (
          q || status ? (
            <EmptyState icon={Users} title="Hech narsa topilmadi" hint="Qidiruv so'zini yoki filtrlarni o'zgartirib ko'ring." />
          ) : (
            <EmptyState icon={Users} title="Hali guruh yo'q" hint="Birinchi guruhni yarating: fan, o'qituvchi va dars kunlarini tanlang — darslar jadvalga o'zi qo'yiladi." action={addButton} />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line bg-canvas/50">
                <tr>
                  {['№', 'Guruh', 'Fan / daraja', "O'qituvchi", 'Jadval', 'Filial / xona', "To'ldirilishi", 'Oylik narx', 'Qarzdorlar', 'Holat'].map((h) => (
                    <th key={h} className={th}>
                      {t(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {units.data.map((g) => {
                  const fill = g.students_count / g.capacity;
                  return (
                    <tr key={g.id} onClick={() => router.push(`/study-units/${g.id}`)} className="group cursor-pointer hover:bg-canvas/40">
                      <td className={`${td} w-12 font-semibold tabular-nums text-brand-strong`}>{g.number}</td>
                      <td className={td}>
                        <Link href={`/study-units/${g.id}`} onClick={(e) => e.stopPropagation()} className="font-medium group-hover:text-brand-strong">
                          {g.name}
                        </Link>
                      </td>
                      <td className={td}>
                        <span className="flex items-center gap-2">
                          <span className="size-2.5 shrink-0 rounded-full" style={{ background: subjectColor(g.discipline.name) }} aria-hidden />
                          {g.discipline.name}
                          {g.level && <span className="text-muted">· {g.level.name}</span>}
                        </span>
                      </td>
                      <td className={td}>{g.teacher.full_name}</td>
                      <td className={`${td} whitespace-nowrap`}>
                        {g.schedule ? (
                          <>
                            {g.schedule.days.map((d) => t(WEEKDAYS_SHORT[d - 1] as string)).join(', ')}
                            <span className="ml-1.5 tabular-nums text-muted">
                              {g.schedule.start_time}–{g.schedule.end_time}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted">{t("Jadval qo'yilmagan")}</span>
                        )}
                      </td>
                      <td className={`${td} text-muted`}>
                        {g.branch.name}
                        {g.classroom && ` · ${g.classroom.name}`}
                      </td>
                      <td className={`${td} min-w-32`}>
                        <div className="flex items-center gap-2.5">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-canvas" aria-hidden>
                            <div className={`h-full rounded-full ${fill >= 1 ? 'bg-warning' : 'bg-brand'}`} style={{ width: `${Math.min(100, fill * 100)}%` }} />
                          </div>
                          <span className="text-xs tabular-nums text-muted">
                            {g.students_count}/{g.capacity}
                          </span>
                        </div>
                      </td>
                      <td className={`${td} whitespace-nowrap tabular-nums`}>{formatMoney(g.price_amount)}</td>
                      <td className={`${td} tabular-nums ${g.debtors_count ? 'font-medium text-danger' : 'text-muted'}`}>{g.debtors_count ? t('{n} kishi', { n: g.debtors_count }) : '—'}</td>
                      <td className={td}>
                        <StatusPill tone={UNIT_STATUS[g.status].tone}>{UNIT_STATUS[g.status].label}</StatusPill>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {creating && <UnitForm onClose={() => setCreating(false)} onCreated={(unit) => router.push(`/study-units/${unit.id}`)} />}
    </>
  );
}

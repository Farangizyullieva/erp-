'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, Building2, CalendarDays, ChevronRight, ClipboardCheck, GraduationCap, Target, UserPlus, Users, Wallet, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { LessonDialog } from '@/components/academic';
import { Avatar, CountUp, EmptyState, ErrorNote, Panel, Select, StatusPill } from '@/components/ui';
import { lessonTime, subjectColor } from '@/lib/academic';
import { timeAgo } from '@/lib/activity';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMoney, formatPhone, studentNo } from '@/lib/format';
import { t } from '@/lib/i18n';
import { STATUS, type StudentStatus } from '@/lib/students';

interface TodayLesson {
  id: string;
  start_at: string;
  end_at: string;
  status: 'planned' | 'completed' | 'cancelled';
  group: string;
  discipline: string;
  teacher: string;
  classroom: string | null;
  students: number;
  marked: number;
}

interface Summary {
  students: {
    total: number;
    by_status: Record<StudentStatus, number>;
    new_this_month: number;
    new_prev_month: number;
    daily: { date: string; count: number }[];
    by_branch: { branch: string; count: number }[];
  } | null;
  leads: { new: number; in_progress: number } | null;
  company: { branches: number; classrooms: number } | null;
  employees: number | null;
  lessons_today: { total: number; completed: number } | null;
  attendance: { marked: number; rate: number | null } | null;
  revenue: { month: number; payments: number } | null;
  today: TodayLesson[] | null;
  recent_students: { id: string; number: number; full_name: string; photo_url: string | null; phone: string | null; branch: string; status: StudentStatus; created_at: string }[] | null;
}

const PERIODS = [7, 30, 90] as const;
// Grafik ranglari tokenlardan: yorug' va to'q rejimda bir xil kod
const BRAND = 'var(--color-brand)';
const AXIS = { fontSize: 11, fill: 'var(--color-muted)' };
const STATUS_COLORS: Record<StudentStatus, string> = { new: 'var(--color-brand)', active: 'var(--color-success)', paused: 'var(--color-warning)', finished: '#94a3b8', archived: '#cbd5e1' };
const tooltipStyle = { borderRadius: 10, border: '1px solid var(--color-line)', background: 'var(--color-surface)', color: 'var(--color-ink)', fontSize: 13, boxShadow: 'var(--shadow-pop)' };

/** Ko'rsatkich kartasi. `value` berilmasa — moduli hali qurilmagan ko'rsatkich (raqam o'ylab topilmaydi) */
function Kpi({ icon: Icon, label, value, format, delta, caption, href }: { icon: LucideIcon; label: string; value?: number | null; format?: (n: number) => string; delta?: number | null; caption: string; href?: string }) {
  const soon = value === undefined;
  const body = (
    <>
      <span className={clsx('grid size-10 place-items-center rounded-lg', soon ? 'bg-canvas text-muted' : 'bg-brand-soft text-brand')}>
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="mt-3.5 truncate text-sm text-ink/80">{t(label)}</p>
      <p className={clsx('mt-1 truncate text-[26px] font-semibold leading-tight tracking-tight tabular-nums', (soon || value === null) && 'text-muted/50')}>
        {soon || value === null ? '—' : <CountUp value={value} format={format} />}
      </p>
      <div className="mt-1.5 flex min-h-5 items-center gap-1 text-[13px] font-medium">
        {delta !== undefined && delta !== null && delta !== 0 && (
          <span className={clsx('inline-flex items-center gap-0.5', delta > 0 ? 'text-success' : 'text-danger')}>
            {delta > 0 ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden />}
            {Math.abs(delta)}%
          </span>
        )}
      </div>
      <p className="mt-0.5 truncate text-xs text-muted">{caption}</p>
    </>
  );
  const frame = 'block rounded-xl border border-line bg-surface p-4 shadow-card';
  return href && !soon ? (
    <Link href={href} className={clsx(frame, 'transition-[border-color,transform] hover:-translate-y-0.5 hover:border-brand/40')}>
      {body}
    </Link>
  ) : (
    <div className={clsx(frame, soon && 'bg-surface/60')}>{body}</div>
  );
}

function Card({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Panel className={className}>
      <header className="flex min-h-14 items-center justify-between gap-3 px-5 pt-1">
        <h2 className="text-base font-semibold">{t(title)}</h2>
        {action}
      </header>
      {children}
    </Panel>
  );
}

const all = (href: string) => (
  <Link href={href} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-3 text-[13px] font-medium hover:bg-canvas">
    {t('Barchasi')}
    <ChevronRight className="size-3.5 text-muted" aria-hidden />
  </Link>
);

/** Bugungi darslar lentasi: soat bo'yicha; bosilsa davomat oynasi ochiladi */
function TodayFeed({ lessons, onOpen }: { lessons: TodayLesson[]; onOpen: (id: string) => void }) {
  const now = Date.now();
  if (lessons.length === 0) return <EmptyState icon={CalendarDays} title="Bugun dars yo'q" />;
  return (
    <ol className="max-h-[23rem] overflow-y-auto pb-2">
      {lessons.map((l) => {
        const started = new Date(l.start_at).getTime() <= now;
        const running = started && new Date(l.end_at).getTime() > now && l.status === 'planned';
        const state =
          l.status === 'cancelled'
            ? ({ tone: 'danger', label: 'Bekor qilingan' } as const)
            : l.marked > 0 || l.status === 'completed'
              ? ({ tone: 'success', label: "Davomat qo'yilgan" } as const)
              : started
                ? ({ tone: 'warning', label: 'Davomat kutilmoqda' } as const)
                : ({ tone: 'neutral', label: 'Boshlanmagan' } as const);
        return (
          <li key={l.id}>
            <button type="button" onClick={() => onOpen(l.id)} className={clsx('flex w-full items-center gap-3.5 px-5 py-2.5 text-left hover:bg-canvas/60', running && 'bg-brand-soft/40')}>
              <span className="w-[5.25rem] shrink-0 text-[13px] font-medium tabular-nums">
                {lessonTime(l.start_at)}
                <span className="text-muted">–{lessonTime(l.end_at)}</span>
              </span>
              <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: subjectColor(l.discipline) }} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className={clsx('block truncate text-sm font-medium', l.status === 'cancelled' && 'text-muted line-through')}>{l.group}</span>
                <span className="block truncate text-xs text-muted">
                  {l.teacher}
                  {l.classroom && ` · ${l.classroom}`} · {t("{n} ta o'quvchi", { n: l.students })}
                </span>
              </span>
              <StatusPill tone={state.tone}>{state.label}</StatusPill>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export default function DashboardPage() {
  const { can } = useAuth();
  const router = useRouter();
  const [branchId, setBranchId] = useState('');
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [openLesson, setOpenLesson] = useState<string | null>(null);
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<{ id: string; name: string; is_active: boolean }[]>('/branches'), enabled: can('branch.view') });
  const summary = useQuery({
    queryKey: ['dashboard', branchId, days],
    queryFn: () => api<Summary>(`/dashboard/summary?days=${days}${branchId ? `&branch_id=${branchId}` : ''}`),
    placeholderData: keepPreviousData,
  });

  const heading = (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight">{t('Ish stoli')}</h1>
        <p className="mt-1 text-sm text-muted">{t("Bugungi faoliyat va asosiy ko'rsatkichlar")}</p>
      </div>
      <div className="flex flex-wrap gap-2.5">
        {(branches.data?.length ?? 0) > 1 && (
          <Select aria-label={t('Filial')} value={branchId} onChange={(e) => setBranchId(e.target.value)} className="h-11 rounded-xl shadow-card">
            <option value="">{t('Barcha filiallar')}</option>
            {branches.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
        <Select aria-label={t('Davr')} value={days} onChange={(e) => setDays(Number(e.target.value) as (typeof PERIODS)[number])} className="h-11 rounded-xl shadow-card">
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {t('Oxirgi {n} kun', { n: p })}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );

  if (summary.isPending) {
    return (
      <>
        {heading}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" role="status" aria-label={t('Yuklanmoqda')}>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-[166px] animate-pulse rounded-xl bg-surface" />
          ))}
        </div>
        <div className="mt-4 h-80 animate-pulse rounded-xl bg-surface" />
      </>
    );
  }
  if (summary.isError) {
    return (
      <>
        {heading}
        <ErrorNote onRetry={() => void summary.refetch()}>{summary.error.message}</ErrorNote>
      </>
    );
  }

  const { students, company, employees, recent_students: recent, lessons_today: lessonsToday, attendance, revenue, today, leads } = summary.data;
  const growth = students && students.new_prev_month > 0 ? Math.round(((students.new_this_month - students.new_prev_month) / students.new_prev_month) * 100) : null;
  const periodTotal = students?.daily.reduce((sum, d) => sum + d.count, 0) ?? 0;
  const statusData = students
    ? (Object.keys(STATUS) as StudentStatus[]).filter((s) => s !== 'archived').map((s) => ({ status: s, name: t(STATUS[s].label), value: students.by_status[s] }))
    : [];
  const maxBranch = Math.max(1, ...(students?.by_branch.map((b) => b.count) ?? []));

  return (
    <div className={clsx('transition-opacity', summary.isPlaceholderData && 'opacity-60')}>
      {heading}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {students && <Kpi icon={Users} label="Faol o'quvchilar" value={students.total} caption={t("{n} tasi hozir o'qiyapti", { n: students.by_status.active })} href="/students" />}
        {students && <Kpi icon={UserPlus} label="Shu oyda yangi o'quvchilar" value={students.new_this_month} delta={growth} caption={t("O'tgan oyga nisbatan")} href="/students" />}
        {company && <Kpi icon={Building2} label="Faol filiallar" value={company.branches} caption={t('{n} ta xona', { n: company.classrooms })} href="/company/branches" />}
        {employees !== null && <Kpi icon={GraduationCap} label="Faol xodimlar" value={employees} caption={t('Tizimga kira oladiganlar')} href="/company/employees" />}
        {leads && <Kpi icon={Target} label="Yangi lidlar" value={leads.new} caption={t('{n} tasi jarayonda', { n: leads.in_progress })} href="/leads" />}
        {lessonsToday && <Kpi icon={CalendarDays} label="Bugungi darslar" value={lessonsToday.total} caption={t('{n} tasi yakunlangan', { n: lessonsToday.completed })} href="/schedule" />}
        {attendance && <Kpi icon={ClipboardCheck} label="Davomat" value={attendance.rate} format={(n) => `${n}%`} caption={t('Oxirgi {n} kun', { n: 30 })} href="/attendance" />}
        {revenue && <Kpi icon={Wallet} label="Shu oydagi tushum" value={revenue.month} format={formatMoney} caption={t("{n} ta to'lov", { n: revenue.payments })} href="/finance" />}
      </div>

      {(today || students) && (
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {today && (
            <Card title="Bugungi darslar" action={all('/schedule')}>
              <TodayFeed lessons={today} onOpen={setOpenLesson} />
            </Card>
          )}
          {students && (
            <Card title="O'quvchilar holati" action={all('/students')}>
              {students.total === 0 ? (
                <EmptyState icon={Users} title="Hali o'quvchi yo'q" />
              ) : (
                <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 px-5 pb-6 pt-2">
                  <div className="relative size-44 shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={statusData} dataKey="value" innerRadius={56} outerRadius={82} paddingAngle={2} stroke="none">
                          {statusData.map((d) => (
                            <Cell key={d.status} fill={STATUS_COLORS[d.status]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: 'var(--color-ink)' }} formatter={(v, name) => [t('{n} ta', { n: String(v) }), String(name)]} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                      <div>
                        <p className="text-2xl font-semibold leading-none tabular-nums">{students.total}</p>
                        <p className="mt-1 text-xs text-muted">{t('jami')}</p>
                      </div>
                    </div>
                  </div>
                  <ul className="min-w-40 flex-1 space-y-2.5">
                    {statusData.map((d) => (
                      <li key={d.status} className="flex items-center gap-2.5 text-sm">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ background: STATUS_COLORS[d.status] }} aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-muted">{d.name}</span>
                        <span className="font-semibold tabular-nums">{d.value}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      {students && (
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card title="Yangi o'quvchilar dinamikasi">
            {periodTotal === 0 ? (
              <EmptyState icon={GraduationCap} title="Tanlangan davrda yangi o'quvchi yo'q" hint="O'quvchi qo'shilganda dinamika shu yerda ko'rinadi." />
            ) : (
              <div className="grid gap-4 px-2 pb-4 md:grid-cols-[minmax(0,1fr)_15rem] md:pr-5">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={students.daily} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                      <defs>
                        <linearGradient id="newStudents" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={BRAND} stopOpacity={0.25} />
                          <stop offset="100%" stopColor={BRAND} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="var(--color-line)" />
                      <XAxis dataKey="date" tickFormatter={(d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`} tick={AXIS} tickLine={false} axisLine={false} minTickGap={28} />
                      <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: 'var(--color-ink)' }} labelFormatter={(d) => formatDate(String(d))} formatter={(v) => [t('{n} ta', { n: String(v) }), t("Yangi o'quvchi")]} />
                      <Area type="monotone" dataKey="count" stroke={BRAND} strokeWidth={2} fill="url(#newStudents)" dot={days <= 30 ? { r: 2.5, fill: BRAND, strokeWidth: 0 } : false} activeDot={{ r: 5 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="px-3 md:px-0">
                  <p className="text-[13px] text-muted">{t('Davr ichida jami')}</p>
                  <p className="mt-0.5 flex items-baseline gap-2 text-2xl font-semibold tabular-nums tracking-tight">
                    {periodTotal}
                    {growth !== null && growth !== 0 && (
                      <span className={clsx('inline-flex items-center gap-0.5 text-sm font-medium', growth > 0 ? 'text-success' : 'text-danger')}>
                        {growth > 0 ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden />}
                        {Math.abs(growth)}%
                      </span>
                    )}
                  </p>
                  <dl className="mt-4 space-y-3 rounded-xl bg-canvas/70 p-4 text-[13px]">
                    {[
                      { label: 'Shu oyda', value: students.new_this_month },
                      { label: "O'tgan oyda", value: students.new_prev_month },
                      { label: "Kuniga o'rtacha", value: (periodTotal / days).toFixed(1) },
                    ].map((row) => (
                      <div key={row.label} className="flex items-center justify-between gap-3">
                        <dt className="text-muted">{t(row.label)}</dt>
                        <dd className="font-semibold tabular-nums">{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            )}
          </Card>

          <Card title="Filiallar bo'yicha o'quvchilar" action={can('branch.view') ? all('/company/branches') : undefined}>
            {students.by_branch.length === 0 ? (
              <EmptyState icon={Building2} title="Hali o'quvchi yo'q" />
            ) : (
              <ul className="space-y-5 px-5 pb-6 pt-2">
                {students.by_branch.map((b) => (
                  <li key={b.branch}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate font-medium">{b.branch}</span>
                      <span className="tabular-nums">
                        <b className="font-semibold">{b.count}</b>
                        <span className="ml-1.5 text-xs text-muted">{Math.round((b.count / Math.max(1, students.total)) * 100)}%</span>
                      </span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-canvas" aria-hidden>
                      <div className="h-full rounded-full bg-brand transition-[width] duration-700" style={{ width: `${Math.max(3, (b.count / maxBranch) * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {recent && (
        <Card title="Yangi qo'shilgan o'quvchilar" action={all('/students')} className="mt-4">
          {recent.length === 0 ? (
            <EmptyState icon={GraduationCap} title="Hali o'quvchi yo'q" hint="Birinchi o'quvchini qo'shing — buning uchun ism va filial yetarli." />
          ) : (
            <div className="overflow-x-auto px-2 pb-2">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="rounded-l-lg bg-canvas/70 px-3 py-2.5 font-medium">{t("O'quvchi")}</th>
                    <th className="bg-canvas/70 px-3 py-2.5 font-medium">{t('Telefon')}</th>
                    <th className="bg-canvas/70 px-3 py-2.5 font-medium">{t('Filial')}</th>
                    <th className="bg-canvas/70 px-3 py-2.5 font-medium">{t('Holat')}</th>
                    <th className="rounded-r-lg bg-canvas/70 px-3 py-2.5 text-right font-medium">{t("Qo'shilgan")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {recent.map((s) => (
                    <tr key={s.id} onClick={() => router.push(`/students/${s.id}`)} className="group cursor-pointer hover:bg-canvas/40">
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-3">
                          <Avatar name={s.full_name} src={s.photo_url} size="sm" />
                          <div className="min-w-0">
                            <Link href={`/students/${s.id}`} onClick={(e) => e.stopPropagation()} className="block truncate text-sm font-medium group-hover:text-brand-strong">
                              {s.full_name}
                            </Link>
                            <p className="text-xs tabular-nums text-muted">{studentNo(s.number)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-[13px] tabular-nums">{formatPhone(s.phone)}</td>
                      <td className="px-3 py-2.5 text-[13px] text-muted">{s.branch}</td>
                      <td className="px-3 py-2.5">
                        <StatusPill tone={STATUS[s.status].tone}>{STATUS[s.status].label}</StatusPill>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs text-muted">{timeAgo(s.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {openLesson && <LessonDialog lessonId={openLesson} onClose={() => setOpenLesson(null)} />}
    </div>
  );
}

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ClipboardCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LessonDialog, MARK_ORDER, MARKS } from '@/components/academic';
import { useToast } from '@/components/toast';
import { AttendanceOverview } from '@/components/attendance-overview';
import { usePanel } from '@/components/portal-gate';
import { EmptyState, ErrorNote, PageHeader, Panel, Segmented, Select, TableSkeleton } from '@/components/ui';
import { addDays, todayIso, unitLabel, type Mark, type StudyUnit } from '@/lib/academic';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { t } from '@/lib/i18n';

interface Matrix {
  study_unit: { id: string; number: number; name: string; teacher: string };
  lessons: { id: string; date: string; status: string; editable: boolean }[];
  rows: { student: { id: string; number: number; full_name: string }; marks: (Mark | 'na' | null)[] }[];
}

const PERIODS = [30, 60, 120] as const;
const attended = (m: Mark | 'na' | null): boolean => m === 'present' || m === 'late';

type View = 'group' | 'all';

// Davomat: guruh kartasi yoki barcha o'quvchilar bo'yicha umumiy ko'rinish
export default function AttendancePage() {
  const [view, setView] = useState<View>('group');
  const switcher = <Segmented label="Ko'rinish" value={view} onChange={setView} options={[{ id: 'group', label: "Guruh bo'yicha" }, { id: 'all', label: "Hamma o'quvchilar" }]} />;
  return view === 'group' ? <GroupMatrix switcher={switcher} /> : <AttendanceOverview switcher={switcher} />;
}

// Davomat kartasi (TZ M5.3, P5 arxetipi): qator = o'quvchi, ustun = dars. Katakni bosib holat tanlanadi.
function GroupMatrix({ switcher }: { switcher: ReactNode }) {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [unitId, setUnitId] = useState('');
  const panel = usePanel();
  // Guruh sahifasidan `?group=<id>` bilan kelinganda — shu guruh tanlangan holda ochiladi
  useEffect(() => {
    const group = new URLSearchParams(window.location.search).get('group');
    if (group) setUnitId(group);
  }, []);
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [cell, setCell] = useState<{ lessonId: string; studentId: string } | null>(null);
  const [openLesson, setOpenLesson] = useState<string | null>(null);
  const popover = useRef<HTMLDivElement>(null);

  const units = useQuery({ queryKey: ['study-units', 'list', '', ''], queryFn: () => api<StudyUnit[]>('/study-units?') });
  const withSchedule = (units.data ?? []).filter((u) => u.schedule);
  const selected = unitId || withSchedule[0]?.id || '';
  const today = todayIso();
  const matrix = useQuery({
    queryKey: ['attendance', selected, days],
    queryFn: () => api<Matrix>(`/attendance/matrix?study_unit_id=${selected}&from=${addDays(today, -days)}&to=${today}`),
    enabled: Boolean(selected),
  });

  const mark = useMutation({
    mutationFn: (v: { lessonId: string; studentId: string; status: Mark }) => api<unknown>(`/lessons/${v.lessonId}/attendance`, { method: 'PUT', body: { entries: [{ student_id: v.studentId, status: v.status }] } }),
    onSuccess: () => Promise.all(['attendance', 'students', 'finance', 'study-units', 'lessons'].map((key) => queryClient.invalidateQueries({ queryKey: [key] }))),
    onError: (e) => toast.error(e.message),
  });

  useEffect(() => {
    if (!cell) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !popover.current?.contains(e.target as Node)) setCell(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [cell]);

  const canMark = can('attendance.mark');
  const data = matrix.data;
  const perLesson = data?.lessons.map((_, i) => data.rows.filter((r) => attended(r.marks[i] ?? null)).length) ?? [];

  return (
    <>
      <PageHeader title="Davomat" description={data ? `${unitLabel(data.study_unit)} · ${data.study_unit.teacher}` : "Guruh bo'yicha davomat kartasi"} action={switcher} />
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2.5">
        <Select aria-label={t('Guruh')} value={selected} onChange={(e) => setUnitId(e.target.value)} disabled={withSchedule.length === 0}>
          {withSchedule.length === 0 && <option value="">{t("Guruh yo'q")}</option>}
          {withSchedule.map((u) => (
            <option key={u.id} value={u.id}>
              {unitLabel(u)} — {u.discipline.name}
            </option>
          ))}
        </Select>
        <Select aria-label={t('Davr')} value={days} onChange={(e) => setDays(Number(e.target.value) as (typeof PERIODS)[number])}>
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {t('Oxirgi {n} kun', { n: p })}
            </option>
          ))}
        </Select>
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
          {MARK_ORDER.map((key) => {
            const m = MARKS[key];
            return (
              <li key={key} className="flex items-center gap-1.5">
                <span className={clsx('grid size-5 place-items-center rounded', m.className)}>
                  <m.icon className="size-3" strokeWidth={3} aria-hidden />
                </span>
                {t(m.label)}
              </li>
            );
          })}
        </ul>
      </div>

      {units.isSuccess && withSchedule.length === 0 ? (
        <Panel>
          <EmptyState
            icon={ClipboardCheck}
            title="Davomat qo'yish uchun jadvali bor guruh kerak"
            hint="Avval guruh yarating va dars kunlarini belgilang."
            action={
              <Link href="/study-units" className="inline-flex h-9.5 items-center rounded-lg bg-brand px-3.5 text-sm font-medium text-white hover:bg-brand-strong">
                {t("Guruhlarga o'tish")}
              </Link>
            }
          />
        </Panel>
      ) : matrix.isPending ? (
        <Panel>
          <TableSkeleton rows={6} />
        </Panel>
      ) : matrix.isError ? (
        <ErrorNote onRetry={() => void matrix.refetch()}>{matrix.error.message}</ErrorNote>
      ) : data && (data.lessons.length === 0 || data.rows.length === 0) ? (
        <Panel>
          <EmptyState icon={ClipboardCheck} title={data.rows.length === 0 ? "Guruhda o'quvchi yo'q" : "Tanlangan davrda dars bo'lmagan"} hint={data.rows.length === 0 ? "Guruh sahifasida o'quvchi qo'shing." : 'Davrni kengaytirib ko\'ring.'} />
        </Panel>
      ) : (
        data && (
          <Panel className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="sticky left-0 z-20 border-b border-line bg-surface px-4 py-2.5 text-left text-xs font-medium text-muted">{t("O'quvchi")}</th>
                  {data.lessons.map((l) => (
                    <th key={l.id} className="border-b border-line px-0.5 py-1.5 text-center">
                      {/* Sana — butun dars davomatini bitta oynada qo'yish */}
                      <button type="button" onClick={() => setOpenLesson(l.id)} title={t("Butun dars davomatini ochish")} className="rounded-md px-1.5 py-1 text-xs font-medium tabular-nums text-muted hover:bg-brand-soft hover:text-brand-strong">
                        {formatDate(l.date).slice(0, 5)}
                      </button>
                    </th>
                  ))}
                  <th className="border-b border-l border-line px-4 py-2.5 text-right text-xs font-medium text-muted">{t('Qatnashdi')}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => {
                  const counted = row.marks.filter((m) => m !== 'na' && m !== null);
                  const came = counted.filter(attended).length;
                  const percent = counted.length ? Math.round((came / counted.length) * 100) : null;
                  return (
                    <tr key={row.student.id} className="group">
                      <th scope="row" className="sticky left-0 z-10 whitespace-nowrap border-b border-line bg-surface px-4 py-1.5 text-left text-sm font-medium group-hover:bg-canvas">
                        {panel === 'teacher' ? (
                          row.student.full_name
                        ) : (
                          <Link href={`/students/${row.student.id}`} className="hover:text-brand-strong">
                            {row.student.full_name}
                          </Link>
                        )}
                      </th>
                      {row.marks.map((value, i) => {
                        const lesson = data.lessons[i];
                        if (!lesson) return null;
                        const m = value && value !== 'na' ? MARKS[value] : null;
                        const open = cell?.lessonId === lesson.id && cell.studentId === row.student.id;
                        const editable = canMark && lesson.editable && value !== 'na';
                        return (
                          <td key={lesson.id} className="relative border-b border-line px-0.5 py-1.5 text-center group-hover:bg-canvas/60">
                            {value === 'na' ? (
                              <span className="text-muted/40" title={t("O'sha kuni guruh a'zosi emas")}>
                                ·
                              </span>
                            ) : (
                              <button
                                type="button"
                                disabled={!editable}
                                onClick={() => setCell(open ? null : { lessonId: lesson.id, studentId: row.student.id })}
                                aria-label={`${row.student.full_name}, ${formatDate(lesson.date)}: ${m ? t(m.label) : t('Belgilanmagan')}`}
                                aria-haspopup="menu"
                                aria-expanded={open}
                                className={clsx('mx-auto grid size-7 place-items-center rounded-md transition-shadow disabled:cursor-default', m ? m.className : 'border border-dashed border-line text-muted', editable && 'hover:ring-2 hover:ring-brand/40', open && 'ring-2 ring-brand')}
                              >
                                {m ? <m.icon className="size-4" strokeWidth={2.5} aria-hidden /> : null}
                              </button>
                            )}
                            {open && (
                              <div ref={popover} role="menu" className="absolute left-1/2 top-full z-30 mt-1 w-52 -translate-x-1/2 animate-in rounded-xl border border-line bg-surface p-1.5 text-left shadow-pop">
                                {MARK_ORDER.map((key) => {
                                  const option = MARKS[key];
                                  return (
                                    <button
                                      key={key}
                                      type="button"
                                      role="menuitemradio"
                                      aria-checked={value === key}
                                      onClick={() => {
                                        setCell(null);
                                        if (value !== key) mark.mutate({ lessonId: lesson.id, studentId: row.student.id, status: key });
                                      }}
                                      className={clsx('flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-sm hover:bg-canvas', value === key && 'bg-canvas font-medium')}
                                    >
                                      <span className={clsx('grid size-6 place-items-center rounded', option.className)}>
                                        <option.icon className="size-3.5" strokeWidth={2.5} aria-hidden />
                                      </span>
                                      {t(option.label)}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </td>
                        );
                      })}
                      <td className="whitespace-nowrap border-b border-l border-line px-4 py-1.5 text-right text-sm tabular-nums group-hover:bg-canvas/60">
                        {came}/{counted.length}
                        <span className={clsx('ml-2 inline-block w-10 font-semibold', percent === null ? 'text-muted' : percent < 60 ? 'text-danger' : percent < 85 ? 'text-warning' : 'text-success')}>{percent === null ? '—' : `${percent}%`}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" className="sticky left-0 z-10 bg-canvas px-4 py-2.5 text-left text-xs font-medium text-muted">
                    {t('Darsda qatnashganlar')}
                  </th>
                  {perLesson.map((n, i) => (
                    <td key={data.lessons[i]?.id} className="bg-canvas px-0.5 py-2.5 text-center text-xs font-semibold tabular-nums">
                      {n}
                    </td>
                  ))}
                  <td className="border-l border-line bg-canvas" />
                </tr>
              </tfoot>
            </table>
          </Panel>
        )
      )}
      {canMark && data && data.lessons.length > 0 && <p className="mt-3 text-xs text-muted">{t("Katakni bosib holatni o'zgartiring; sanani bosib butun dars davomatini bitta oynada qo'ying.")}</p>}
      {openLesson && <LessonDialog lessonId={openLesson} onClose={() => setOpenLesson(null)} />}
    </>
  );
}

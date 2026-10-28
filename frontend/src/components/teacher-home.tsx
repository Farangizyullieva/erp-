'use client';

import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, CalendarDays, ClipboardCheck, Clock, DoorOpen, GraduationCap, Users, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { LessonDialog } from '@/components/academic';
import { Button, CountUp, EmptyState, ErrorNote, Panel, StatusPill } from '@/components/ui';
import { addDays, lessonTime, subjectColor, todayIso, unitLabel, WEEKDAYS_SHORT, type Lesson, type StudyUnit } from '@/lib/academic';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatLongDate } from '@/lib/format';
import { t } from '@/lib/i18n';

function Stat({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <span className={`grid size-10 place-items-center rounded-lg ${tone}`}>
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="mt-3 text-sm text-ink/80">{t(label)}</p>
      <p className="mt-0.5 text-[26px] font-semibold leading-tight tabular-nums tracking-tight">
        <CountUp value={value} />
      </p>
    </div>
  );
}

// O'qituvchi paneli: bugungi darslari, davomat qo'yilmagan darslar va o'z guruhlari. Server faqat o'zinikini qaytaradi.
export function TeacherHome() {
  const { me, can } = useAuth();
  const today = todayIso();
  const [openLesson, setOpenLesson] = useState<string | null>(null);
  // Bir so'rov: oxirgi 14 kun (qo'yilmagan davomat) + kelgusi 6 kun (yaqin darslar)
  const lessons = useQuery({ queryKey: ['lessons', 'teacher-home', today], queryFn: () => api<Lesson[]>(`/lessons?from=${addDays(today, -14)}&to=${addDays(today, 6)}`) });
  const units = useQuery({ queryKey: ['study-units', 'list', '', ''], queryFn: () => api<StudyUnit[]>('/study-units?') });

  const all = (lessons.data ?? []).filter((l) => l.status !== 'cancelled');
  const todays = all.filter((l) => l.date === today);
  const unmarked = all.filter((l) => l.date < today && l.marked_count === 0).reverse();
  const upcoming = all.filter((l) => l.date > today).slice(0, 6);
  const groups = (units.data ?? []).filter((u) => u.status !== 'finished');
  const now = Date.now();

  return (
    <>
      <div className="mb-5">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight">{t('Assalomu alaykum, {name}!', { name: me.full_name.split(' ').slice(-1)[0] ?? me.full_name })}</h1>
        <p className="mt-1 text-sm capitalize text-muted">{formatLongDate(new Date())}</p>
      </div>

      {lessons.isError ? (
        <ErrorNote onRetry={() => void lessons.refetch()}>{lessons.error.message}</ErrorNote>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat icon={CalendarDays} label="Bugungi darslar" value={todays.length} tone="bg-brand-soft text-brand" />
            <Stat icon={Users} label="Guruhlarim" value={groups.length} tone="bg-success-soft text-success" />
            <Stat icon={GraduationCap} label="O'quvchilarim" value={groups.reduce((sum, g) => sum + g.students_count, 0)} tone="bg-info-soft text-info" />
            <Stat icon={AlertTriangle} label="Davomat qo'yilmagan" value={unmarked.length} tone={unmarked.length ? 'bg-danger-soft text-danger' : 'bg-canvas text-muted'} />
          </div>

          <div className="mt-4 grid items-start gap-4 lg:grid-cols-5">
            <Panel className="overflow-hidden lg:col-span-3">
              <h2 className="border-b border-line px-5 py-3.5 font-semibold">{t('Bugungi darslarim')}</h2>
              {lessons.isPending ? (
                <div className="m-5 h-32 animate-pulse rounded-lg bg-canvas" role="status" />
              ) : todays.length === 0 ? (
                <EmptyState icon={CalendarDays} title="Bugun darsingiz yo'q" hint="Yaqin darslar pastda ko'rinadi." />
              ) : (
                <ul className="divide-y divide-line">
                  {todays.map((l) => {
                    const live = new Date(l.start_at).getTime() <= now && now < new Date(l.end_at).getTime();
                    return (
                      <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-2.5 px-5 py-3.5">
                        <span className="w-1 self-stretch rounded-full" style={{ background: subjectColor(l.study_unit.discipline) }} aria-hidden />
                        <div className="w-24 shrink-0 text-sm font-semibold tabular-nums">
                          {lessonTime(l.start_at)}–{lessonTime(l.end_at)}
                        </div>
                        <div className="min-w-40 flex-1">
                          <p className="truncate text-sm font-medium">{unitLabel(l.study_unit)}</p>
                          <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                            <span>{l.study_unit.discipline}</span>
                            {l.classroom && (
                              <span className="flex items-center gap-1">
                                <DoorOpen className="size-3" aria-hidden />
                                {l.classroom.name}
                              </span>
                            )}
                          </p>
                        </div>
                        {live && <StatusPill tone="success">Hozir</StatusPill>}
                        {can('attendance.mark') && (
                          <Button size="sm" variant={l.marked_count ? 'secondary' : 'primary'} onClick={() => setOpenLesson(l.id)} className="max-sm:w-full">
                            <ClipboardCheck className="size-4" aria-hidden /> {l.marked_count ? t('Davomat ({n})', { n: l.marked_count }) : t("Davomat qo'yish")}
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {upcoming.length > 0 && (
                <>
                  <h2 className="border-y border-line bg-canvas/50 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted">{t('Yaqin darslar')}</h2>
                  <ul className="divide-y divide-line">
                    {upcoming.map((l) => (
                      <li key={l.id} className="flex items-center gap-4 px-5 py-2.5 text-sm">
                        <span className="w-24 shrink-0 tabular-nums text-muted">{formatDate(l.date).slice(0, 5)}</span>
                        <span className="w-24 shrink-0 tabular-nums">
                          {lessonTime(l.start_at)}–{lessonTime(l.end_at)}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{unitLabel(l.study_unit)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Panel>

            <div className="space-y-4 lg:col-span-2">
              {unmarked.length > 0 && (
                <Panel className="overflow-hidden border-danger/40">
                  <h2 className="flex items-center gap-2 border-b border-line px-5 py-3.5 font-semibold">
                    <AlertTriangle className="size-4 text-danger" aria-hidden /> {t("Davomat qo'yilmagan darslar")}
                  </h2>
                  <ul className="divide-y divide-line">
                    {unmarked.slice(0, 8).map((l) => (
                      <li key={l.id}>
                        <button type="button" onClick={() => setOpenLesson(l.id)} className="flex w-full items-center justify-between gap-3 px-5 py-2.5 text-left text-sm hover:bg-canvas/50">
                          <span className="min-w-0 truncate">{unitLabel(l.study_unit)}</span>
                          <span className="flex shrink-0 items-center gap-1 tabular-nums text-muted">
                            <Clock className="size-3" aria-hidden />
                            {formatDate(l.date).slice(0, 5)} · {lessonTime(l.start_at)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}

              <Panel className="overflow-hidden">
                <h2 className="border-b border-line px-5 py-3.5 font-semibold">{t('Mening guruhlarim')}</h2>
                {units.isPending ? (
                  <div className="m-5 h-24 animate-pulse rounded-lg bg-canvas" role="status" />
                ) : groups.length === 0 ? (
                  <EmptyState icon={Users} title="Sizga hali guruh biriktirilmagan" />
                ) : (
                  <ul className="divide-y divide-line">
                    {groups.map((g) => (
                      <li key={g.id}>
                        <Link href={`/teacher/groups/${g.id}`} className="block px-5 py-3 hover:bg-canvas/50">
                          <div className="flex items-center justify-between gap-3">
                            <p className="min-w-0 truncate text-sm font-medium">{unitLabel(g)}</p>
                            <span className="shrink-0 text-xs tabular-nums text-muted">
                              {g.students_count}/{g.capacity}
                            </span>
                          </div>
                          <p className={clsx('mt-0.5 text-xs text-muted')}>
                            {g.discipline.name}
                            {g.schedule && ` · ${g.schedule.days.map((d) => t(WEEKDAYS_SHORT[d - 1] as string)).join(', ')} ${g.schedule.start_time}–${g.schedule.end_time}`}
                          </p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </div>
        </>
      )}
      {openLesson && <LessonDialog lessonId={openLesson} onClose={() => setOpenLesson(null)} />}
    </>
  );
}

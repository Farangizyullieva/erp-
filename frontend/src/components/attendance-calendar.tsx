'use client';

import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { MARKS } from '@/components/academic';
import { EmptyState, ErrorNote, TableSkeleton } from '@/components/ui';
import { lessonTime, todayIso, WEEKDAYS_SHORT, type Mark } from '@/lib/academic';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { t } from '@/lib/i18n';

interface Calendar {
  month: string;
  today: string;
  days: { lesson_id: string; date: string; start_at: string; group: string; cancelled: boolean; status: Mark | null }[];
  summary: { lessons: number; marked: number; attended: number; rate: number | null };
}

const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const shift = (month: string, by: number): string => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** Bir oylik davomat kalendari: har bir dars kuni rangli katak, bir qarashda kim qanday qatnashayotgani ko'rinadi */
export function AttendanceCalendar({ studentId }: { studentId: string }) {
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const calendar = useQuery({ queryKey: ['students', studentId, 'attendance', month], queryFn: () => api<Calendar>(`/students/${studentId}/attendance?month=${month}`) });
  const [year, monthIndex] = month.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(year, monthIndex - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // dushanbadan boshlanadi
  const cells: (number | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const byDate = new Map<string, Calendar['days']>();
  for (const d of calendar.data?.days ?? []) byDate.set(d.date, [...(byDate.get(d.date) ?? []), d]);
  const summary = calendar.data?.summary;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setMonth(shift(month, -1))} aria-label={t('Oldingi oy')} className="grid size-8 place-items-center rounded-lg hover:bg-canvas">
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <span className="min-w-32 text-center text-sm font-semibold capitalize">
            {t(MONTHS[monthIndex - 1] as string)} {year}
          </span>
          <button type="button" onClick={() => setMonth(shift(month, 1))} aria-label={t('Keyingi oy')} className="grid size-8 place-items-center rounded-lg hover:bg-canvas">
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
        {summary && (
          <dl className="flex gap-5 text-sm">
            {[
              { label: 'Darslar', value: summary.lessons },
              { label: 'Belgilangan', value: summary.marked },
              { label: 'Qatnashish', value: summary.rate === null ? '—' : `${summary.rate}%`, tone: summary.rate === null ? '' : summary.rate < 60 ? 'text-danger' : summary.rate < 85 ? 'text-warning' : 'text-success' },
            ].map((item) => (
              <div key={item.label} className="text-right">
                <dt className="text-xs text-muted">{t(item.label)}</dt>
                <dd className={clsx('font-semibold tabular-nums', item.tone)}>{item.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {calendar.isPending ? (
        <TableSkeleton rows={4} />
      ) : calendar.isError ? (
        <div className="p-4">
          <ErrorNote onRetry={() => void calendar.refetch()}>{calendar.error.message}</ErrorNote>
        </div>
      ) : calendar.data.days.length === 0 ? (
        <EmptyState icon={CalendarDays} title="Bu oyda dars yo'q" />
      ) : (
        <div className="p-4 sm:p-5">
          <div className="grid grid-cols-7 gap-1.5 text-center">
            {WEEKDAYS_SHORT.map((day) => (
              <div key={day} className="pb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                {t(day)}
              </div>
            ))}
            {cells.map((day, i) => {
              if (day === null) return <div key={`empty-${i}`} />;
              const date = `${month}-${String(day).padStart(2, '0')}`;
              const lessons = byDate.get(date) ?? [];
              const isToday = date === calendar.data.today;
              return (
                <div key={date} className={clsx('flex min-h-16 flex-col items-center gap-1 rounded-lg border p-1.5', isToday ? 'border-brand' : 'border-transparent', lessons.length ? 'bg-canvas/60' : '')}>
                  <span className={clsx('text-xs tabular-nums', isToday ? 'font-semibold text-brand' : lessons.length ? 'text-ink' : 'text-muted/60')}>{day}</span>
                  <div className="flex flex-wrap justify-center gap-1">
                    {lessons.map((l) => {
                      const mark = l.status ? MARKS[l.status] : null;
                      const label = `${formatDate(l.date)} · ${lessonTime(l.start_at)} · ${l.group} — ${l.cancelled ? t('Bekor qilingan') : mark ? t(mark.label) : t('Hali belgilanmagan')}`;
                      return (
                        <span key={l.lesson_id} title={label} aria-label={label} className={clsx('grid size-7 place-items-center rounded-md', l.cancelled ? 'border border-dashed border-muted/40 text-muted/50' : mark ? mark.className : 'border border-dashed border-line text-muted')}>
                          {mark && !l.cancelled ? <mark.icon className="size-4" strokeWidth={2.5} aria-hidden /> : null}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line pt-3 text-xs text-muted">
            {(Object.keys(MARKS) as Mark[]).map((key) => {
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
      )}
    </div>
  );
}

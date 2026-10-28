'use client';

import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import Link from 'next/link';
import { EmptyState, ErrorNote, PageHeader, StatusPill } from '@/components/ui';
import { subjectColor, UNIT_STATUS, WEEKDAYS_SHORT, type StudyUnit } from '@/lib/academic';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';

// O'qituvchining guruhlari (server faqat o'zi dars beradiganlarini qaytaradi)
export default function TeacherGroupsPage() {
  const units = useQuery({ queryKey: ['study-units', 'list', '', ''], queryFn: () => api<StudyUnit[]>('/study-units?') });
  return (
    <>
      <PageHeader title="Guruhlarim" description="Siz dars beradigan guruhlar" />
      {units.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl bg-surface" />
          ))}
        </div>
      ) : units.isError ? (
        <ErrorNote onRetry={() => void units.refetch()}>{units.error.message}</ErrorNote>
      ) : units.data.length === 0 ? (
        <EmptyState icon={Users} title="Sizga hali guruh biriktirilmagan" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {units.data.map((g) => (
            <Link key={g.id} href={`/teacher/groups/${g.id}`} className="group rounded-xl border border-line bg-surface p-5 shadow-card transition-colors hover:border-success/50">
              <div className="flex items-start justify-between gap-3">
                <span className="rounded-lg bg-success-soft px-2 py-1 text-sm font-semibold tabular-nums text-success">{g.number}</span>
                <StatusPill tone={UNIT_STATUS[g.status].tone}>{UNIT_STATUS[g.status].label}</StatusPill>
              </div>
              <p className="mt-3 font-semibold group-hover:text-success">{g.name}</p>
              <p className="mt-1 flex items-center gap-2 text-sm text-muted">
                <span className="size-2.5 rounded-full" style={{ background: subjectColor(g.discipline.name) }} aria-hidden />
                {g.discipline.name}
                {g.level && ` · ${g.level.name}`}
              </p>
              <p className="mt-3 text-xs text-muted">
                {g.schedule ? `${g.schedule.days.map((d) => t(WEEKDAYS_SHORT[d - 1] as string)).join(', ')} · ${g.schedule.start_time}–${g.schedule.end_time}` : t("Jadval qo'yilmagan")}
                {g.classroom && ` · ${g.classroom.name}`}
              </p>
              <div className="mt-4 flex items-center gap-2.5">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-canvas" aria-hidden>
                  <div className="h-full rounded-full bg-success" style={{ width: `${Math.min(100, (g.students_count / g.capacity) * 100)}%` }} />
                </div>
                <span className="text-xs tabular-nums text-muted">{t("{n} ta o'quvchi", { n: g.students_count })}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

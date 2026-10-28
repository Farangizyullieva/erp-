'use client';

import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Users } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Avatar, BackButton, EmptyState, ErrorNote, Panel, StatusPill, TableSkeleton } from '@/components/ui';
import { UNIT_STATUS, unitLabel, WEEKDAYS_SHORT, type Member, type StudyUnit } from '@/lib/academic';
import { api } from '@/lib/api';
import { formatDate, formatPhone, studentNo } from '@/lib/format';
import { t } from '@/lib/i18n';

// Guruh — o'qituvchi ko'rinishi: o'quvchilar ro'yxati va davomat kartasiga o'tish. Pul ma'lumoti ko'rsatilmaydi.
export default function TeacherGroupPage() {
  const { id } = useParams<{ id: string }>();
  const unit = useQuery({ queryKey: ['study-units', id], queryFn: () => api<StudyUnit & { members: Member[] }>(`/study-units/${id}`) });
  const g = unit.data;
  const members = g?.members.filter((m) => m.active) ?? [];

  return (
    <>
      <div className="mb-3">
        <BackButton />
      </div>
      {unit.isError ? (
        <ErrorNote onRetry={() => void unit.refetch()}>{unit.error.message}</ErrorNote>
      ) : !g ? (
        <Panel>
          <TableSkeleton rows={6} />
        </Panel>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-[22px] font-semibold leading-tight tracking-tight">{unitLabel(g)}</h1>
                <StatusPill tone={UNIT_STATUS[g.status].tone}>{UNIT_STATUS[g.status].label}</StatusPill>
              </div>
              <p className="mt-1 text-sm text-muted">
                {g.discipline.name}
                {g.level && ` · ${g.level.name}`}
                {g.schedule && ` · ${g.schedule.days.map((d) => t(WEEKDAYS_SHORT[d - 1] as string)).join(', ')} ${g.schedule.start_time}–${g.schedule.end_time}`}
                {g.classroom && ` · ${g.classroom.name}`}
              </p>
            </div>
            <Link href={`/teacher/attendance?group=${g.id}`} className="inline-flex h-9.5 items-center gap-2 rounded-lg bg-success px-3.5 text-sm font-medium text-white hover:opacity-90">
              <ClipboardCheck className="size-4" aria-hidden /> {t('Davomat kartasi')}
            </Link>
          </div>
          <Panel className="overflow-hidden">
            <h2 className="border-b border-line px-5 py-3.5 font-semibold">{t("O'quvchilar ({n})", { n: members.length })}</h2>
            {members.length === 0 ? (
              <EmptyState icon={Users} title="Guruhda o'quvchi yo'q" />
            ) : (
              <ul className="divide-y divide-line">
                {members.map((m) => (
                  <li key={m.enrollment_id} className="flex items-center gap-3 px-5 py-3">
                    <Avatar name={m.student.full_name} src={m.student.photo_url} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{m.student.full_name}</p>
                      <p className="text-xs tabular-nums text-muted">
                        {studentNo(m.student.number)} · {t('{date} dan beri', { date: formatDate(m.start_date) })}
                      </p>
                    </div>
                    {m.student.phone && <span className="hidden text-sm tabular-nums text-muted sm:block">{formatPhone(m.student.phone)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </>
  );
}

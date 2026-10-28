'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Building2, CalendarDays, ChevronLeft, ChevronRight, Clock, DoorOpen, Plus, User } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { LessonDialog, UnitForm } from '@/components/academic';
import { useToast } from '@/components/toast';
import { Button, EmptyState, ErrorNote, Field, Modal, PageHeader, Panel, Segmented, Select, SelectField } from '@/components/ui';
import { addDays, lessonHours, lessonTime, mondayOf, subjectColor, todayIso, unitLabel, WEEKDAYS, type Lesson, type Ref, type StudyUnit } from '@/lib/academic';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { t } from '@/lib/i18n';

const HOUR_PX = 56;

/** Bir vaqtda o'tadigan darslar ustma-ust tushmasligi uchun yonma-yon ustunlarga (lane) taqsimlanadi */
function layoutDay(lessons: Lesson[]): { lesson: Lesson; lane: number; lanes: number }[] {
  const laneEnds: number[] = [];
  const placed = [...lessons]
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
    .map((lesson) => {
      let lane = laneEnds.findIndex((end) => end <= lessonHours(lesson.start_at));
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = lessonHours(lesson.end_at);
      return { lesson, lane };
    });
  return placed.map((p) => ({ ...p, lanes: laneEnds.length }));
}

// Jadval (TZ M4.6, P4 arxetipi): haftalik kalendar. Darsni bossangiz — davomat va bekor qilish.
export default function SchedulePage() {
  const { can } = useAuth();
  const today = todayIso();
  const [mode, setMode] = useState<'week' | 'branches'>('week');
  // Filiallar ko'rinishi bitta kunni ko'rsatadi
  const [day, setDay] = useState(today);
  const [weekStart, setWeekStart] = useState(mondayOf(today));
  const [branchId, setBranchId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [openLesson, setOpenLesson] = useState<string | null>(null);
  const [creating, setCreating] = useState<'unit' | 'lesson' | null>(null);
  const weekEnd = addDays(weekStart, 6);

  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<Ref[]>('/branches'), enabled: can('branch.view') });
  const people = useQuery({ queryKey: ['employees', 'options'], queryFn: () => api<{ id: string; full_name: string }[]>('/employees/options') });
  const byBranch = mode === 'branches';
  const params = new URLSearchParams(byBranch ? { from: day, to: day } : { from: weekStart, to: weekEnd });
  if (branchId && !byBranch) params.set('branch_id', branchId);
  if (teacherId) params.set('teacher_id', teacherId);
  const lessons = useQuery({ queryKey: ['lessons', byBranch ? day : weekStart, byBranch ? 'by-branch' : branchId, teacherId], queryFn: () => api<Lesson[]>(`/lessons?${params.toString()}`) });

  const all = lessons.data ?? [];
  const firstHour = Math.min(9, ...all.map((l) => Math.floor(lessonHours(l.start_at))));
  const lastHour = Math.max(20, ...all.map((l) => Math.ceil(lessonHours(l.end_at))));
  const hours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i);
  // Yakshanba ustuni faqat shu kuni dars bo'lsa ko'rsatiladi
  const dayCount = all.some((l) => l.date === weekEnd) ? 7 : 6;
  const days = Array.from({ length: dayCount }, (_, i) => addDays(weekStart, i));
  const subjects = [...new Set(all.map((l) => l.study_unit.discipline))].sort();

  return (
    <>
      <PageHeader
        title="Jadval"
        description={byBranch ? "Bir kunlik darslar filiallar kesimida. Darsni bosib davomat qo'ying" : "Haftalik darslar jadvali. Darsni bosib davomat qo'ying"}
        action={
          <>
            {can('schedule.create') && (
              <Button variant="secondary" onClick={() => setCreating('lesson')}>
                <Plus className="size-4" aria-hidden /> Dars qo'shish
              </Button>
            )}
            {can('study_unit.create') && (
              <Button onClick={() => setCreating('unit')}>
                <Plus className="size-4" aria-hidden /> Guruh qo'shish
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <Segmented label="Ko'rinish" value={mode} onChange={setMode} options={[{ id: 'week', label: 'Hafta' }, { id: 'branches', label: "Filiallar bo'yicha" }]} />
        <div className="flex items-center rounded-lg border border-line bg-surface">
          <button type="button" onClick={() => (byBranch ? setDay(addDays(day, -1)) : setWeekStart(addDays(weekStart, -7)))} aria-label={t(byBranch ? 'Oldingi kun' : 'Oldingi hafta')} className="grid size-9.5 place-items-center rounded-l-lg hover:bg-canvas">
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <span className="min-w-44 border-x border-line px-3 text-center text-sm font-medium tabular-nums">
            {byBranch ? `${t(WEEKDAYS[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7] as string)}, ${formatDate(day)}` : `${formatDate(weekStart)} – ${formatDate(weekEnd)}`}
          </span>
          <button type="button" onClick={() => (byBranch ? setDay(addDays(day, 1)) : setWeekStart(addDays(weekStart, 7)))} aria-label={t(byBranch ? 'Keyingi kun' : 'Keyingi hafta')} className="grid size-9.5 place-items-center rounded-r-lg hover:bg-canvas">
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            setDay(today);
            setWeekStart(mondayOf(today));
          }}
          disabled={byBranch ? day === today : weekStart === mondayOf(today)}
        >
          Bugun
        </Button>
        {!byBranch && (branches.data?.length ?? 0) > 1 && (
          <Select aria-label={t('Filial')} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">{t('Barcha filiallar')}</option>
            {branches.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
        <Select aria-label={t("O'qituvchi")} value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
          <option value="">{t("Barcha o'qituvchilar")}</option>
          {people.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </Select>
        <ul className="ml-auto flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {subjects.map((subject) => (
            <li key={subject} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: subjectColor(subject) }} aria-hidden /> {subject}
            </li>
          ))}
        </ul>
      </div>

      {lessons.isError ? (
        <ErrorNote onRetry={() => void lessons.refetch()}>{lessons.error.message}</ErrorNote>
      ) : byBranch ? (
        <BranchBoard lessons={all} branches={branches.data ?? []} loading={lessons.isPending} onOpen={setOpenLesson} />
      ) : !lessons.isPending && all.length === 0 ? (
        <Panel>
          <EmptyState
            icon={CalendarDays}
            title="Bu haftada dars yo'q"
            hint="Guruh yarating va dars kunlarini tanlang — darslar jadvalga o'zi qo'yiladi. Yoki bitta qo'shimcha dars qo'shing."
            action={
              can('study_unit.create') && (
                <Button onClick={() => setCreating('unit')}>
                  <Plus className="size-4" aria-hidden /> Guruh qo'shish
                </Button>
              )
            }
          />
        </Panel>
      ) : (
        <Panel className={clsx('overflow-x-auto transition-opacity', lessons.isFetching && 'opacity-70')}>
          <div className="grid min-w-[900px]" style={{ gridTemplateColumns: `56px repeat(${dayCount}, minmax(0, 1fr))` }}>
            <div className="border-b border-line bg-canvas/50" />
            {days.map((date, i) => (
              <div key={date} className={clsx('border-b border-l border-line px-3 py-2 text-center', date === today ? 'bg-brand-soft' : 'bg-canvas/50')}>
                <p className={clsx('text-xs font-medium uppercase tracking-wide', date === today ? 'text-brand-strong' : 'text-muted')}>{t(WEEKDAYS[i] as string)}</p>
                <p className={clsx('text-xs tabular-nums', date === today ? 'font-semibold text-brand-strong' : 'text-muted')}>{formatDate(date).slice(0, 5)}</p>
              </div>
            ))}

            <div className="relative" style={{ height: hours.length * HOUR_PX }}>
              {hours.map((h) => (
                <span key={h} className="absolute right-2 text-[11px] tabular-nums text-muted" style={{ top: (h - firstHour) * HOUR_PX + 3 }}>
                  {String(h).padStart(2, '0')}:00
                </span>
              ))}
            </div>
            {days.map((date) => (
              <div
                key={date}
                className={clsx('relative border-l border-line', date === today && 'bg-brand-soft/25')}
                style={{ height: hours.length * HOUR_PX, backgroundImage: `repeating-linear-gradient(to bottom, transparent 0 ${HOUR_PX - 1}px, var(--color-line) ${HOUR_PX - 1}px ${HOUR_PX}px)` }}
              >
                {layoutDay(all.filter((l) => l.date === date)).map(({ lesson: l, lane, lanes }) => {
                  const top = (lessonHours(l.start_at) - firstHour) * HOUR_PX;
                  const height = (lessonHours(l.end_at) - lessonHours(l.start_at)) * HOUR_PX;
                  const cancelled = l.status === 'cancelled';
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => setOpenLesson(l.id)}
                      title={`${unitLabel(l.study_unit)} · ${l.branch.name} · ${lessonTime(l.start_at)}–${lessonTime(l.end_at)} · ${l.teacher.full_name}${l.classroom ? ` · ${l.classroom.name}` : ''}`}
                      className={clsx('absolute overflow-hidden rounded-lg px-2 py-1.5 text-left shadow-card transition-transform hover:z-10 hover:scale-[1.02] focus-visible:z-10', cancelled ? 'border border-dashed border-muted/50 bg-canvas text-muted line-through' : 'text-white')}
                      style={{ top: top + 2, height: height - 4, left: `calc(${(lane / lanes) * 100}% + 3px)`, width: `calc(${100 / lanes}% - 6px)`, background: cancelled ? undefined : subjectColor(l.study_unit.discipline), opacity: l.status === 'completed' ? 0.72 : 1 }}
                    >
                      <p className="truncate text-xs font-semibold">{unitLabel(l.study_unit)}</p>
                      <p className="truncate text-[11px] opacity-90">{l.teacher.full_name}</p>
                      <p className="truncate text-[11px] opacity-80">
                        {lessonTime(l.start_at)}–{lessonTime(l.end_at)}
                        {l.classroom && ` · ${l.classroom.name}`}
                      </p>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </Panel>
      )}
      <p className="mt-3 text-xs text-muted">{t("Xiraroq bloklar — yakunlangan darslar; chiziqli bloklar — bekor qilinganlar.")}</p>

      {openLesson && <LessonDialog lessonId={openLesson} onClose={() => setOpenLesson(null)} />}
      {creating === 'unit' && <UnitForm onClose={() => setCreating(null)} />}
      {creating === 'lesson' && <ExtraLesson defaultDate={byBranch ? day : weekStart <= today && today <= weekEnd ? today : weekStart} onClose={() => setCreating(null)} />}
    </>
  );
}

/** Filiallar bo'yicha: har bir filial — alohida ustun, ichida shu kungi darslar vaqt tartibida */
function BranchBoard({ lessons, branches, loading, onOpen }: { lessons: Lesson[]; branches: Ref[]; loading: boolean; onOpen: (id: string) => void }) {
  // Filiallar ro'yxatini ko'rish ruxsati bo'lmasa — darslarning o'zidan yig'iladi
  const known = new Map<string, Ref>(branches.map((b) => [b.id, b]));
  for (const l of lessons) if (!known.has(l.branch.id)) known.set(l.branch.id, l.branch);
  const columns = [...known.values()];
  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" role="status">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-64 animate-pulse rounded-xl bg-surface" />
        ))}
      </div>
    );
  }
  if (columns.length === 0) {
    return (
      <Panel>
        <EmptyState icon={Building2} title="Bu kunda dars yo'q" hint="Boshqa kunni tanlang yoki guruh jadvalini qo'ying." />
      </Panel>
    );
  }
  return (
    <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {columns.map((branch) => {
        const list = lessons.filter((l) => l.branch.id === branch.id).sort((a, b) => a.start_at.localeCompare(b.start_at));
        const active = list.filter((l) => l.status !== 'cancelled');
        return (
          <Panel key={branch.id} className="overflow-hidden">
            <header className="flex items-center gap-3 border-b border-line bg-canvas/50 px-4 py-3">
              <span className="grid size-9 place-items-center rounded-lg bg-brand-soft text-brand">
                <Building2 className="size-[18px]" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-semibold">{branch.name}</h2>
                <p className="text-xs text-muted">{t('{n} ta dars', { n: active.length })}</p>
              </div>
            </header>
            {list.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">{t("Bu kunda dars yo'q")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {list.map((l) => {
                  const cancelled = l.status === 'cancelled';
                  return (
                    <li key={l.id}>
                      <button type="button" onClick={() => onOpen(l.id)} className={clsx('flex w-full items-stretch gap-3 px-4 py-3 text-left hover:bg-canvas/50', cancelled && 'text-muted line-through', l.status === 'completed' && 'opacity-75')}>
                        <span className="w-1 shrink-0 rounded-full" style={{ background: cancelled ? 'var(--color-line)' : subjectColor(l.study_unit.discipline) }} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{unitLabel(l.study_unit)}</span>
                          <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                            <span className="flex items-center gap-1 tabular-nums">
                              <Clock className="size-3" aria-hidden />
                              {lessonTime(l.start_at)}–{lessonTime(l.end_at)}
                            </span>
                            <span className="flex items-center gap-1">
                              <User className="size-3" aria-hidden />
                              {l.teacher.full_name}
                            </span>
                            {l.classroom && (
                              <span className="flex items-center gap-1">
                                <DoorOpen className="size-3" aria-hidden />
                                {l.classroom.name}
                              </span>
                            )}
                          </span>
                        </span>
                        <span className="shrink-0 self-center text-xs text-muted">{cancelled ? t('Bekor qilingan') : l.status === 'completed' ? t('Yakunlangan') : l.study_unit.discipline}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        );
      })}
    </div>
  );
}

/** Jadval qoidasidan tashqari bitta qo'shimcha dars */
function ExtraLesson({ defaultDate, onClose }: { defaultDate: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const units = useQuery({ queryKey: ['study-units', 'list', '', ''], queryFn: () => api<StudyUnit[]>('/study-units?') });
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<Lesson>('/lessons', { method: 'POST', body }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['lessons'] });
      toast.success("Dars jadvalga qo'shildi");
      onClose();
    },
  });
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    create.mutate(Object.fromEntries(new FormData(e.currentTarget)));
  };
  const active = (units.data ?? []).filter((u) => u.status !== 'finished');
  return (
    <Modal title="Qo'shimcha dars" description="Jadvaldan tashqari bitta dars. Doimiy darslar uchun guruh jadvalini o'zgartiring" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <SelectField label="Guruh" name="study_unit_id" required defaultValue="" key={active.length}>
          <option value="">{t('Tanlang…')}</option>
          {active.map((u) => (
            <option key={u.id} value={u.id}>
              {unitLabel(u)} — {u.teacher.full_name}
            </option>
          ))}
        </SelectField>
        <Field label="Sana" name="date" type="date" defaultValue={defaultDate} required />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Boshlanish vaqti" name="start_time" type="time" defaultValue="09:00" required />
          <Field label="Tugash vaqti" name="end_time" type="time" defaultValue="10:30" required />
        </div>
        {create.isError && <ErrorNote>{create.error.message}</ErrorNote>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button type="submit" loading={create.isPending}>
            Qo'shish
          </Button>
        </div>
      </form>
    </Modal>
  );
}

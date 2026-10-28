'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { CalendarCheck, CalendarDays, ChevronLeft, ChevronRight, Clock, DoorOpen, GraduationCap, KeyRound, LogOut, Moon, Receipt, Sun, User, Wallet, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { MARKS } from '@/components/academic';
import { useToast } from '@/components/toast';
import { Avatar, Button, ConfirmDialog, EmptyState, ErrorNote, Field, IconButton, Modal, Panel, StatusPill, Tabs } from '@/components/ui';
import { lessonTime, METHODS, subjectColor, WEEKDAYS_SHORT, type Mark } from '@/lib/academic';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime, formatMoney, studentNo } from '@/lib/format';
import { t } from '@/lib/i18n';
import { STATUS, type StudentStatus } from '@/lib/students';
import { useTheme } from '@/lib/theme';

interface PortalLesson {
  id: string;
  date: string;
  start_at: string;
  end_at: string;
  cancelled: boolean;
  group: string;
  discipline: string;
  teacher: string;
  classroom: string | null;
  mark: Mark | null;
}

interface PortalMe {
  center: string;
  today: string;
  student: { number: number; full_name: string; phone: string | null; status: StudentStatus; photo_url: string | null; branch: { name: string; address: string | null; phone: string | null } };
  balance: number;
  monthly_price: number;
  next_payment_date: string | null;
  attendance: { marked: number; attended: number; rate: number | null };
  groups: { number: number; name: string; course: string; teacher: string; classroom: string | null; schedule: { days: number[]; start_time: string; end_time: string } | null; price_amount: number; next_payment_date: string | null }[];
  upcoming: PortalLesson[];
}

interface PortalPayments {
  balance: number;
  entries: { id: string; type: string; amount: number; occurred_at: string; method: string | null; comment: string | null }[];
}

const ENTRY: Record<string, string> = { payment: "To'lov", subscription: 'Oylik abonement', charge: 'Yechim', reversal: 'Yechim bekor qilindi', refund: 'Qaytarish', adjustment: 'Tuzatish' };
const weekday = (date: string): string => t(WEEKDAYS_SHORT[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7] as string);
const shiftMonth = (ym: string, by: number): string => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};

function Stat({ icon: Icon, label, value, caption, tone }: { icon: LucideIcon; label: string; value: string; caption?: string; tone: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <span className={`grid size-10 place-items-center rounded-xl ${tone}`}>
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="mt-3 text-[13px] text-muted">{t(label)}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums tracking-tight">{value}</p>
      {caption && <p className="mt-1 text-xs text-muted">{caption}</p>}
    </div>
  );
}

function LessonRow({ lesson, today }: { lesson: PortalLesson; today: string }) {
  const mark = lesson.mark ? MARKS[lesson.mark] : null;
  return (
    <li className={clsx('flex items-stretch gap-3 px-4 py-3', lesson.cancelled && 'opacity-55')}>
      <div className={clsx('grid w-12 shrink-0 place-items-center rounded-xl text-center', lesson.date === today ? 'bg-brand text-white' : 'bg-canvas')}>
        <div>
          <p className="text-[11px] font-medium uppercase leading-none opacity-80">{weekday(lesson.date)}</p>
          <p className="mt-0.5 text-base font-semibold leading-none tabular-nums">{lesson.date.slice(8)}</p>
        </div>
      </div>
      <span className="w-1 shrink-0 rounded-full" style={{ background: subjectColor(lesson.discipline) }} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={clsx('truncate text-sm font-medium', lesson.cancelled && 'line-through')}>{lesson.discipline}</p>
        <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
          <span className="flex items-center gap-1 tabular-nums">
            <Clock className="size-3" aria-hidden />
            {lessonTime(lesson.start_at)}–{lessonTime(lesson.end_at)}
          </span>
          <span className="flex items-center gap-1">
            <User className="size-3" aria-hidden />
            {lesson.teacher}
          </span>
          {lesson.classroom && (
            <span className="flex items-center gap-1">
              <DoorOpen className="size-3" aria-hidden />
              {lesson.classroom}
            </span>
          )}
        </p>
      </div>
      <div className="shrink-0 self-center">
        {lesson.cancelled ? (
          <span className="text-xs text-muted">{t('Bekor qilingan')}</span>
        ) : mark ? (
          <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium', mark.className)}>
            <mark.icon className="size-3.5" strokeWidth={2.5} aria-hidden />
            {t(mark.short)}
          </span>
        ) : null}
      </div>
    </li>
  );
}

// O'quvchi kabineti: o'z jadvali, davomati, balansi va to'lovlari. Faqat ko'rish — hech narsa o'zgartirilmaydi.
export default function PortalPage() {
  const { logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [tab, setTab] = useState<'home' | 'lessons' | 'payments'>('home');
  const [month, setMonth] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [changing, setChanging] = useState(false);
  const me = useQuery({ queryKey: ['portal', 'me'], queryFn: () => api<PortalMe>('/portal/me') });
  const lessons = useQuery({ queryKey: ['portal', 'lessons', month], queryFn: () => api<{ month: string; today: string; lessons: PortalLesson[] }>(`/portal/lessons${month ? `?month=${month}` : ''}`), enabled: tab === 'lessons' });
  const payments = useQuery({ queryKey: ['portal', 'payments'], queryFn: () => api<PortalPayments>('/portal/payments'), enabled: tab === 'payments' });
  const d = me.data;

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-15 max-w-3xl items-center gap-3 px-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand text-white">
            <GraduationCap className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight">{d?.center ?? 'EduCRM'}</p>
            <p className="text-xs text-muted">{t("O'quvchi kabineti")}</p>
          </div>
          <button type="button" onClick={toggle} aria-label={t(theme === 'dark' ? "Yorug' rejim" : "Qorong'i rejim")} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-canvas hover:text-ink">
            {theme === 'dark' ? <Sun className="size-[18px]" aria-hidden /> : <Moon className="size-[18px]" aria-hidden />}
          </button>
          <IconButton label="Parolni o'zgartirish" icon={KeyRound} onClick={() => setChanging(true)} />
          <Button variant="secondary" size="sm" onClick={() => setLeaving(true)}>
            <LogOut className="size-4" aria-hidden /> Chiqish
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-12 pt-5">
        {me.isPending ? (
          <div className="space-y-4" role="status" aria-label={t('Yuklanmoqda')}>
            <div className="h-28 animate-pulse rounded-2xl bg-surface" />
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-32 animate-pulse rounded-2xl bg-surface" />
              ))}
            </div>
          </div>
        ) : me.isError ? (
          <ErrorNote onRetry={() => void me.refetch()}>{me.error.message}</ErrorNote>
        ) : (
          d && (
            <>
              <section className="flex items-center gap-4 rounded-2xl bg-brand p-5 text-white shadow-card">
                <div className="rounded-full ring-2 ring-white/40">
                  <Avatar name={d.student.full_name} src={d.student.photo_url} size="lg" />
                </div>
                <div className="min-w-0">
                  <h1 className="truncate text-xl font-semibold leading-tight">{d.student.full_name}</h1>
                  <p className="mt-1 text-sm text-white/80">
                    <span className="tabular-nums">ID {studentNo(d.student.number)}</span> · {d.student.branch.name}
                  </p>
                  <div className="mt-2">
                    <StatusPill tone={STATUS[d.student.status].tone}>{STATUS[d.student.status].label}</StatusPill>
                  </div>
                </div>
              </section>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat
                  icon={Wallet}
                  label={d.balance < 0 ? 'Qarzdorlik' : 'Balans'}
                  value={formatMoney(Math.abs(d.balance))}
                  caption={d.next_payment_date ? t("Keyingi to'lov: {date}", { date: formatDate(d.next_payment_date) }) : undefined}
                  tone={d.balance < 0 ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'}
                />
                <Stat
                  icon={CalendarCheck}
                  label="Shu oydagi davomat"
                  value={d.attendance.rate === null ? '—' : `${d.attendance.rate}%`}
                  caption={d.attendance.marked ? t('{total} ta darsdan {came} tasiga keldingiz', { total: d.attendance.marked, came: d.attendance.attended }) : t('Hali belgilanmagan')}
                  tone="bg-brand-soft text-brand"
                />
                <div className="col-span-2 sm:col-span-1">
                  <Stat icon={Receipt} label="Oylik to'lov" value={d.monthly_price ? formatMoney(d.monthly_price) : '—'} caption={t('{n} ta guruh', { n: d.groups.length })} tone="bg-warning-soft text-warning" />
                </div>
              </div>

              <div className="mt-5">
                <Tabs tabs={[{ id: 'home', label: 'Asosiy' }, { id: 'lessons', label: 'Jadval va davomat' }, { id: 'payments', label: "To'lovlar" }]} value={tab} onChange={setTab} />
              </div>

              {tab === 'home' && (
                <div className="mt-4 space-y-4">
                  <Panel className="overflow-hidden">
                    <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">{t('Yaqin darslar')}</h2>
                    {d.upcoming.length === 0 ? (
                      <EmptyState icon={CalendarDays} title="Yaqin 7 kunda dars yo'q" />
                    ) : (
                      <ul className="divide-y divide-line">
                        {d.upcoming.map((l) => (
                          <LessonRow key={l.id} lesson={l} today={d.today} />
                        ))}
                      </ul>
                    )}
                  </Panel>

                  <Panel className="overflow-hidden">
                    <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">{t('Mening guruhlarim')}</h2>
                    {d.groups.length === 0 ? (
                      <EmptyState icon={GraduationCap} title="Hali guruhga biriktirilmagansiz" hint="Guruhga qo'shilganingizdan keyin jadval shu yerda ko'rinadi." />
                    ) : (
                      <ul className="divide-y divide-line">
                        {d.groups.map((g) => (
                          <li key={g.number} className="px-4 py-3.5">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-medium">
                                  <span className="mr-1.5 rounded-md bg-brand-soft px-1.5 py-0.5 text-xs tabular-nums text-brand-strong">{g.number}</span>
                                  {g.name}
                                </p>
                                <p className="mt-1 text-xs text-muted">
                                  {g.course} · {g.teacher}
                                  {g.classroom && ` · ${g.classroom}`}
                                </p>
                              </div>
                              <p className="shrink-0 text-sm font-semibold tabular-nums">{formatMoney(g.price_amount)}</p>
                            </div>
                            {g.schedule && (
                              <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                                {g.schedule.days.map((day) => (
                                  <span key={day} className="rounded-md bg-canvas px-1.5 py-0.5 font-medium">
                                    {t(WEEKDAYS_SHORT[day - 1] as string)}
                                  </span>
                                ))}
                                <span className="ml-1 tabular-nums text-muted">
                                  {g.schedule.start_time}–{g.schedule.end_time}
                                </span>
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Panel>
                  <p className="px-1 text-xs text-muted">
                    {[d.student.branch.address, d.student.branch.phone].filter(Boolean).join(' · ')}
                  </p>
                </div>
              )}

              {tab === 'lessons' && (
                <Panel className="mt-4 overflow-hidden">
                  <div className="flex items-center justify-between border-b border-line px-2 py-2">
                    <button type="button" onClick={() => setMonth(shiftMonth(lessons.data?.month ?? d.today.slice(0, 7), -1))} aria-label={t('Oldingi oy')} className="grid size-9 place-items-center rounded-lg hover:bg-canvas">
                      <ChevronLeft className="size-4" aria-hidden />
                    </button>
                    <p className="text-sm font-semibold tabular-nums">{(lessons.data?.month ?? d.today.slice(0, 7)).split('-').reverse().join('.')}</p>
                    <button type="button" onClick={() => setMonth(shiftMonth(lessons.data?.month ?? d.today.slice(0, 7), 1))} aria-label={t('Keyingi oy')} className="grid size-9 place-items-center rounded-lg hover:bg-canvas">
                      <ChevronRight className="size-4" aria-hidden />
                    </button>
                  </div>
                  {lessons.isPending ? (
                    <div className="m-4 h-40 animate-pulse rounded-lg bg-canvas" role="status" />
                  ) : lessons.isError ? (
                    <div className="p-4">
                      <ErrorNote onRetry={() => void lessons.refetch()}>{lessons.error.message}</ErrorNote>
                    </div>
                  ) : lessons.data.lessons.length === 0 ? (
                    <EmptyState icon={CalendarDays} title="Bu oyda dars yo'q" />
                  ) : (
                    <ul className="divide-y divide-line">
                      {lessons.data.lessons.map((l) => (
                        <LessonRow key={l.id} lesson={l} today={lessons.data.today} />
                      ))}
                    </ul>
                  )}
                </Panel>
              )}

              {tab === 'payments' && (
                <Panel className="mt-4 overflow-hidden">
                  {payments.isPending ? (
                    <div className="m-4 h-40 animate-pulse rounded-lg bg-canvas" role="status" />
                  ) : payments.isError ? (
                    <div className="p-4">
                      <ErrorNote onRetry={() => void payments.refetch()}>{payments.error.message}</ErrorNote>
                    </div>
                  ) : payments.data.entries.length === 0 ? (
                    <EmptyState icon={Wallet} title="Hali to'lov va yechim yo'q" />
                  ) : (
                    <ul className="divide-y divide-line">
                      {payments.data.entries.map((e) => (
                        <li key={e.id} className="flex items-center justify-between gap-4 px-4 py-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{t(ENTRY[e.type] ?? e.type)}</p>
                            <p className="truncate text-xs tabular-nums text-muted">{e.type === 'subscription' ? e.comment : [formatDateTime(e.occurred_at), e.method && t(METHODS[e.method] ?? e.method)].filter(Boolean).join(' · ')}</p>
                          </div>
                          <span className={clsx('shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums', e.amount > 0 ? 'text-success' : 'text-ink')}>
                            {e.amount > 0 ? '+' : ''}
                            {formatMoney(e.amount)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              )}
            </>
          )
        )}
      </main>
      {changing && <ChangePassword onClose={() => setChanging(false)} />}
      {leaving && <ConfirmDialog title="Tizimdan chiqish" message="Kabinetdan chiqmoqchimisiz?" confirmLabel="Chiqish" onConfirm={() => void logout()} onClose={() => setLeaving(false)} />}
    </div>
  );
}

/** O'quvchi parolni o'zi tanlaydi: joriy parol va yangisi (kamida 6 belgi) */
function ChangePassword({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ current: '', next: '', repeat: '' });
  const save = useMutation({
    mutationFn: () => api<unknown>('/portal/password', { method: 'POST', body: { current_password: form.current, new_password: form.next } }),
    onSuccess: () => {
      toast.success('Parol o\'zgartirildi');
      onClose();
    },
  });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors() : {};
  const mismatch = form.repeat.length > 0 && form.repeat !== form.next;
  return (
    <Modal title="Parolni o'zgartirish" description="O'zingiz eslab qoladigan parol tanlang — kamida 6 ta belgi" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!mismatch) save.mutate();
        }}
      >
        <Field label="Joriy parol" type="password" autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} required autoFocus error={errors.current_password} />
        <Field label="Yangi parol" type="password" autoComplete="new-password" minLength={6} value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} required error={errors.new_password} />
        <Field label="Yangi parolni takrorlang" type="password" autoComplete="new-password" value={form.repeat} onChange={(e) => setForm({ ...form, repeat: e.target.value })} required error={mismatch ? t('Parollar bir xil emas') : undefined} />
        {save.isError && Object.keys(errors).length === 0 && <ErrorNote>{save.error.message}</ErrorNote>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button type="submit" loading={save.isPending} disabled={mismatch}>
            Saqlash
          </Button>
        </div>
      </form>
    </Modal>
  );
}

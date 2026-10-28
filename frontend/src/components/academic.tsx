'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, Clock, FileCheck, Search, X, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ReceiptDialog } from '@/components/receipt';
import { useToast } from '@/components/toast';
import { Avatar, Button, Drawer, ErrorNote, Field, Modal, SelectField, StatusPill } from '@/components/ui';
import { addDays, lessonTime, METHODS, todayIso, unitLabel, WEEKDAYS_SHORT, type Lesson, type Mark, type Ref, type Schedule, type StudyUnit } from '@/lib/academic';
import { api, ApiError, apiPage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMoney, studentNo } from '@/lib/format';
import { t } from '@/lib/i18n';

const legend = 'mb-3 text-xs font-semibold uppercase tracking-wide text-muted';
const input = 'h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/15';

// Status faqat rang bilan emas, ikonka bilan ham ajratiladi (TZ 11.6)
export const MARKS: Record<Mark, { label: string; short: string; icon: LucideIcon; className: string }> = {
  present: { label: 'Keldi', short: 'Keldi', icon: Check, className: 'bg-success-soft text-success' },
  late: { label: 'Kech qoldi', short: 'Kech', icon: Clock, className: 'bg-warning-soft text-warning' },
  absent_unexcused: { label: 'Kelmadi (sababsiz)', short: 'Kelmadi', icon: X, className: 'bg-danger-soft text-danger' },
  absent_excused: { label: 'Kelmadi (sababli)', short: 'Sababli', icon: FileCheck, className: 'bg-info-soft text-info' },
};
export const MARK_ORDER = Object.keys(MARKS) as Mark[];

/** So'mda kiritiladi, API'ga tiyinda ketadi (TZ M6.1) */
export function MoneyField({ label, name, defaultTiyin, required, hint, error }: { label: string; name: string; defaultTiyin?: number; required?: boolean; hint?: string; error?: string }) {
  const [text, setText] = useState(defaultTiyin ? String(Math.round(defaultTiyin / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : '');
  return (
    <>
      <Field
        label={label}
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ' '))}
        placeholder="0"
        required={required}
        hint={hint}
        error={error}
        trailing={<span className="pr-3 text-sm text-muted">{t("so'm")}</span>}
      />
      <input type="hidden" name={name} value={text ? Number(text.replace(/\s/g, '')) * 100 : ''} />
    </>
  );
}

/** Hafta kunlari tanlagichi (7 ta tugma) */
export function WeekdayPicker({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
  return (
    <div role="group" aria-label={t('Hafta kunlari')} className="flex flex-wrap gap-1.5">
      {WEEKDAYS_SHORT.map((day, i) => {
        const on = value.includes(i + 1);
        return (
          <button
            key={day}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((d) => d !== i + 1) : [...value, i + 1].sort())}
            className={clsx('h-9 min-w-11 rounded-lg border px-2 text-[13px] font-medium transition-colors', on ? 'border-brand bg-brand text-white' : 'border-line bg-surface hover:bg-canvas')}
          >
            {t(day)}
          </button>
        );
      })}
    </div>
  );
}

function ScheduleFields({ days, setDays, schedule }: { days: number[]; setDays: (d: number[]) => void; schedule?: Schedule | null }) {
  const today = todayIso();
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-[13px] font-medium">{t('Hafta kunlari')}</p>
        <WeekdayPicker value={days} onChange={setDays} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Boshlanish vaqti" name="start_time" type="time" defaultValue={schedule?.start_time ?? '09:00'} required={days.length > 0} />
        <Field label="Tugash vaqti" name="end_time" type="time" defaultValue={schedule?.end_time ?? '10:30'} required={days.length > 0} />
        <Field label="Kurs boshlanishi" name="period_start" type="date" defaultValue={schedule?.period_start ?? today} required={days.length > 0} />
        <Field label="Kurs tugashi" name="period_end" type="date" defaultValue={schedule?.period_end ?? addDays(today, 90)} required={days.length > 0} />
      </div>
    </div>
  );
}

const readSchedule = (form: FormData, days: number[]): Schedule => ({
  days,
  start_time: String(form.get('start_time')),
  end_time: String(form.get('end_time')),
  period_start: String(form.get('period_start')),
  period_end: String(form.get('period_end')),
});

/** Yangi guruh: asosiy ma'lumot + jadval. Jadval berilsa darslar darhol generatsiya qilinadi va konflikt tekshiriladi. */
export function UnitForm({ onClose, onCreated }: { onClose: () => void; onCreated?: (unit: StudyUnit) => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [branchId, setBranchId] = useState('');
  const [days, setDays] = useState<number[]>([1, 3, 5]);
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<(Ref & { is_active: boolean })[]>('/branches') });
  const dictionaries = useQuery({ queryKey: ['dictionaries', 'active'], queryFn: () => api<(Ref & { kind: string })[]>('/dictionaries') });
  const people = useQuery({ queryKey: ['employees', 'options'], queryFn: () => api<{ id: string; full_name: string }[]>('/employees/options') });
  const active = (branches.data ?? []).filter((b) => b.is_active);
  const branch = branchId || (active.length === 1 ? (active[0]?.id ?? '') : '');
  const rooms = useQuery({ queryKey: ['branches', branch, 'classrooms'], queryFn: () => api<(Ref & { is_active: boolean })[]>(`/branches/${branch}/classrooms`), enabled: Boolean(branch) });
  const ofKind = (kind: string) => (dictionaries.data ?? []).filter((d) => d.kind === kind);

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<StudyUnit & { lessons_created: number }>('/study-units', { method: 'POST', body }),
    onSuccess: async (unit) => {
      await Promise.all(['study-units', 'lessons', 'dashboard'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      toast.success(unit.lessons_created ? t("«{name}» guruhi yaratildi, {n} ta dars jadvalga qo'yildi", { name: unit.name, n: unit.lessons_created }) : t('«{name}» guruhi yaratildi', { name: unit.name }));
      onCreated?.(unit);
      onClose();
    },
  });
  const errors = create.error instanceof ApiError ? create.error.fieldErrors() : {};
  const conflict = create.error instanceof ApiError && create.error.code === 'SCHEDULE_CONFLICT' ? create.error : null;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = (name: string): string => String(form.get(name) ?? '').trim();
    create.mutate({
      name: text('name'),
      branch_id: branch,
      discipline_id: text('discipline_id'),
      level_id: text('level_id') || undefined,
      teacher_id: text('teacher_id'),
      classroom_id: text('classroom_id') || undefined,
      capacity: Number(text('capacity')),
      price_amount: Number(text('price_amount')),
      ...(days.length ? { schedule: readSchedule(form, days) } : {}),
    });
  }

  return (
    <Drawer
      title="Yangi guruh"
      description="Guruh va uning dars jadvali. Jadval keyin ham o'zgartirilishi mumkin"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button type="submit" form="unit-form" loading={create.isPending}>
            Yaratish
          </Button>
        </>
      }
    >
      <form id="unit-form" onSubmit={onSubmit} className="space-y-6">
        <fieldset className="space-y-4">
          <legend className={legend}>{t('Guruh')}</legend>
          <Field label="Guruh nomi" name="name" placeholder="Masalan: ENG-A2-01" required minLength={2} maxLength={80} autoFocus error={errors.name} />
          <SelectField label="Filial" value={branch} onChange={(e) => setBranchId(e.target.value)} required error={errors.branch_id}>
            {active.length !== 1 && <option value="">{t('Tanlang…')}</option>}
            {active.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </SelectField>
          <div className="grid grid-cols-2 gap-4">
            <SelectField label="Fan" name="discipline_id" required defaultValue="" key={`d${dictionaries.data?.length}`} error={errors.discipline_id}>
              <option value="">{t('Tanlang…')}</option>
              {ofKind('discipline').map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </SelectField>
            <SelectField label="Daraja" name="level_id" defaultValue="" key={`l${dictionaries.data?.length}`}>
              <option value="">{t("Ko'rsatilmagan")}</option>
              {ofKind('level').map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </SelectField>
          </div>
          <SelectField label="O'qituvchi" name="teacher_id" required defaultValue="" key={`t${people.data?.length}`} error={errors.teacher_id}>
            <option value="">{t('Tanlang…')}</option>
            {people.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Xona" name="classroom_id" defaultValue="" key={`r${branch}${rooms.data?.length}`} hint={branch ? undefined : 'Avval filialni tanlang'} error={errors.classroom_id}>
            <option value="">{t('Xonasiz (onlayn)')}</option>
            {rooms.data?.filter((r) => r.is_active).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </SelectField>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Sig'im" name="capacity" type="number" min={1} max={500} defaultValue={12} required error={errors.capacity} />
            <MoneyField label="Oylik abonement narxi" name="price_amount" required hint="Har oy to'liq yechiladi" error={errors.price_amount} />
          </div>
        </fieldset>

        <fieldset>
          <legend className={legend}>{t('Dars jadvali')}</legend>
          <ScheduleFields days={days} setDays={setDays} />
          {days.length === 0 && <p className="mt-3 text-xs text-muted">{t("Kun tanlanmasa guruh jadvalsiz («Shakllanmoqda») yaratiladi.")}</p>}
        </fieldset>

        {conflict && (
          <div role="alert" className="rounded-lg border border-danger/25 bg-danger-soft p-3.5 text-sm text-danger">
            <p className="font-medium">{conflict.message}</p>
            {conflict.details.length > 1 && (
              <ul className="mt-2 space-y-0.5 text-[13px]">
                {conflict.details.slice(0, 6).map((d, i) => (
                  <li key={i}>• {d.message}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {create.isError && !conflict && Object.keys(errors).length === 0 && <ErrorNote>{create.error.message}</ErrorNote>}
      </form>
    </Drawer>
  );
}

/** Mavjud guruh jadvalini o'zgartirish: o'tgan darslar tegilmaydi, bugundan keyingilari qayta tuziladi */
export function ScheduleDialog({ unit, onClose }: { unit: StudyUnit; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [days, setDays] = useState<number[]>(unit.schedule?.days ?? [1, 3, 5]);
  const save = useMutation({
    mutationFn: (body: Schedule) => api<{ lessons_created: number }>(`/study-units/${unit.id}/schedule`, { method: 'PUT', body }),
    onSuccess: async (r) => {
      await Promise.all(['study-units', 'lessons'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      toast.success(t("Jadval saqlandi, {n} ta dars qo'yildi", { n: r.lessons_created }));
      onClose();
    },
  });
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (days.length) save.mutate(readSchedule(new FormData(e.currentTarget), days));
  };
  return (
    <Modal title="Dars jadvali" description={unit.name} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <ScheduleFields days={days} setDays={setDays} schedule={unit.schedule} />
        {unit.schedule && <p className="text-xs leading-relaxed text-muted">{t("O'tgan va davomati bor darslar o'zgarmaydi — faqat bugundan keyingi darslar yangi jadvalga o'tadi.")}</p>}
        {save.isError && <ErrorNote>{save.error.message}</ErrorNote>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button type="submit" loading={save.isPending} disabled={days.length === 0}>
            Saqlash
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export interface StudentHit {
  id: string;
  number: number;
  full_name: string;
  branch: { name: string };
}

/** O'quvchini ism, telefon yoki ID bo'yicha qidirib tanlash */
export function StudentPicker({ value, onChange }: { value: StudentHit | null; onChange: (student: StudentHit | null) => void }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const hits = useQuery({ queryKey: ['students', 'pick', debounced], queryFn: () => apiPage<StudentHit>(`/students?limit=8&q=${encodeURIComponent(debounced)}`), enabled: !value });

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-brand bg-brand-soft/60 px-3 py-2">
        <span className="min-w-0 text-sm">
          <span className="font-medium">{value.full_name}</span> <span className="tabular-nums text-muted">{studentNo(value.number)}</span>
        </span>
        <button type="button" onClick={() => onChange(null)} className="shrink-0 text-[13px] font-medium text-brand hover:text-brand-strong">
          {t("O'zgartirish")}
        </button>
      </div>
    );
  }
  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Ism, telefon yoki ID')} aria-label={t("O'quvchini qidirish")} autoFocus className={clsx(input, 'pl-9')} />
      </div>
      <ul className="mt-1.5 max-h-52 overflow-y-auto rounded-lg border border-line">
        {hits.isPending ? (
          <li className="px-3 py-2.5 text-[13px] text-muted">{t('Yuklanmoqda…')}</li>
        ) : (hits.data?.data.length ?? 0) === 0 ? (
          <li className="px-3 py-2.5 text-[13px] text-muted">{t('Hech narsa topilmadi')}</li>
        ) : (
          hits.data?.data.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => onChange(s)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-canvas">
                <span className="min-w-0 truncate">
                  <span className="font-medium">{s.full_name}</span> <span className="text-xs tabular-nums text-muted">{studentNo(s.number)}</span>
                </span>
                <span className="shrink-0 text-xs text-muted">{s.branch.name}</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

/** To'lov qabul qilish. O'quvchi berilmasa — qidirib tanlanadi. */
export function PaymentDialog({ student, onClose }: { student?: { id: string; number: number; full_name: string }; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [picked, setPicked] = useState<StudentHit | null>(null);
  const [done, setDone] = useState<{ id: string; note: string } | null>(null);
  const target = student ?? picked;
  const pay = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ id: string; balance: number; receipt_sent: boolean }>('/payments', { method: 'POST', body }),
    onSuccess: async (r) => {
      await Promise.all(['finance', 'payments', 'students', 'study-units', 'dashboard'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      toast.success(t("To'lov qabul qilindi. Yangi balans: {sum}", { sum: formatMoney(r.balance) }));
      // Oyna yopilmaydi: chek ko'rsatiladi — chop etish yoki shunchaki yopish mumkin
      setDone({ id: r.id, note: r.receipt_sent ? t("Chek ota-onaga Telegram orqali yuborildi") : t("Ota-onasi Telegram'ga ulanmagan — chekni chop etib bering") });
    },
  });
  const errors = pay.error instanceof ApiError ? pay.error.fieldErrors() : {};
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!target) return;
    const form = new FormData(e.currentTarget);
    pay.mutate({ student_id: target.id, amount: Number(form.get('amount')), method: form.get('method'), date: form.get('date'), comment: String(form.get('comment') ?? '').trim() || undefined });
  };

  if (done) return <ReceiptDialog paymentId={done.id} note={done.note} onClose={onClose} />;

  return (
    <Modal title="To'lov qabul qilish" description={student ? `${student.full_name} · ${studentNo(student.number)}` : undefined} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        {!student && (
          <div>
            <p className="mb-1.5 text-[13px] font-medium">{t("O'quvchi")}</p>
            <StudentPicker value={picked} onChange={setPicked} />
          </div>
        )}
        <MoneyField label="Summa" name="amount" required error={errors.amount} />
        <div className="grid grid-cols-2 gap-4">
          <SelectField label="To'lov usuli" name="method" defaultValue="cash">
            {Object.entries(METHODS).map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </SelectField>
          <Field label="Sana" name="date" type="date" defaultValue={todayIso()} max={todayIso()} required error={errors.date} />
        </div>
        <Field label="Izoh" name="comment" maxLength={300} placeholder="Masalan: oktabr oyi uchun" />
        {pay.isError && Object.keys(errors).length === 0 && <ErrorNote>{pay.error.message}</ErrorNote>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button type="submit" loading={pay.isPending} disabled={!target}>
            Qabul qilish
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** To'lov o'quvchi kartochkasida kiritiladi: bu oyna o'quvchini topib, uning shaxsiy hisobiga olib boradi */
export function PayStudentPicker({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  return (
    <Modal title="To'lov qabul qilish" description="O'quvchini tanlang — uning shaxsiy hisobi ochiladi va to'lovni o'sha yerda kiritasiz" onClose={onClose}>
      <div className="min-h-40">
        <StudentPicker
          value={null}
          onChange={(student) => {
            if (!student) return;
            onClose();
            router.push(`/students/${student.id}?pay=1`);
          }}
        />
      </div>
    </Modal>
  );
}

interface Roster {
  lesson: Lesson;
  students: { id: string; number: number; full_name: string; photo_url: string | null; status: Mark | null }[];
}

/**
 * Bitta dars oynasi: ma'lumot, davomat (sukut bo'yicha hamma "keldi" — faqat istisnolar belgilanadi, M5.4) va bekor qilish.
 * Davomat pul hisobiga ta'sir qilmaydi (to'lov — oylik abonement).
 */
export function LessonDialog({ lessonId, onClose }: { lessonId: string; onClose: () => void }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const roster = useQuery({ queryKey: ['lessons', lessonId, 'attendance'], queryFn: () => api<Roster>(`/lessons/${lessonId}/attendance`) });
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [cancelling, setCancelling] = useState(false);
  useEffect(() => {
    if (roster.data) setMarks(Object.fromEntries(roster.data.students.map((s) => [s.id, s.status ?? 'present'])));
  }, [roster.data]);
  const refresh = () => Promise.all(['lessons', 'attendance', 'study-units', 'students', 'finance', 'dashboard'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));

  const save = useMutation({
    mutationFn: () => api<{ saved: number }>(`/lessons/${lessonId}/attendance`, { method: 'PUT', body: { entries: Object.entries(marks).map(([student_id, status]) => ({ student_id, status })), complete: true } }),
    onSuccess: async () => {
      await refresh();
      toast.success('Davomat saqlandi, dars yakunlandi');
      onClose();
    },
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => api<Lesson>(`/lessons/${lessonId}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: async () => {
      await refresh();
      toast.success('Dars bekor qilindi');
      onClose();
    },
  });

  if (roster.isPending) {
    return (
      <Modal title="Dars" onClose={onClose}>
        <div className="space-y-2" role="status">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-canvas" />
          ))}
        </div>
      </Modal>
    );
  }
  if (roster.isError) {
    return (
      <Modal title="Dars" onClose={onClose}>
        <ErrorNote>{roster.error.message}</ErrorNote>
      </Modal>
    );
  }
  const { lesson, students } = roster.data;
  const future = lesson.date > todayIso();
  const cancelled = lesson.status === 'cancelled';
  const editable = !future && !cancelled && can('attendance.mark');

  return (
    <Modal wide title={unitLabel(lesson.study_unit)} description={`${formatDate(lesson.date)} · ${lessonTime(lesson.start_at)}–${lessonTime(lesson.end_at)} · ${lesson.teacher.full_name}${lesson.classroom ? ` · ${lesson.classroom.name}` : ''}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={cancelled ? 'danger' : lesson.status === 'completed' ? 'success' : 'neutral'}>{cancelled ? 'Bekor qilingan' : lesson.status === 'completed' ? 'Yakunlangan' : 'Rejalashtirilgan'}</StatusPill>
          {cancelled && lesson.cancel_reason && <span className="text-[13px] text-muted">{lesson.cancel_reason}</span>}
        </div>

        {cancelling ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              cancel.mutate(String(new FormData(e.currentTarget).get('reason')).trim());
            }}
            className="space-y-3"
          >
            <Field label="Bekor qilish sababi" name="reason" required minLength={2} maxLength={200} autoFocus placeholder="Masalan: o'qituvchi kasal" />
            <p className="text-xs text-muted">{t("To'lov oylik abonement bo'lgani uchun dars bekor qilinsa pul qaytarilmaydi.")}</p>
            {cancel.isError && <ErrorNote>{cancel.error.message}</ErrorNote>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCancelling(false)}>
                Orqaga
              </Button>
              <Button type="submit" variant="danger" loading={cancel.isPending}>
                Darsni bekor qilish
              </Button>
            </div>
          </form>
        ) : (
          <>
            {students.length === 0 ? (
              <p className="rounded-lg bg-canvas/70 px-3.5 py-3 text-sm text-muted">{t("Bu dars kuni guruhda o'quvchi yo'q.")}</p>
            ) : future ? (
              <p className="rounded-lg bg-canvas/70 px-3.5 py-3 text-sm text-muted">{t("Davomat dars kuni qo'yiladi. Guruhda {n} ta o'quvchi bor.", { n: students.length })}</p>
            ) : (
              <ul className="max-h-[46vh] divide-y divide-line overflow-y-auto rounded-lg border border-line">
                {students.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium">
                      <Avatar name={s.full_name} src={s.photo_url} size="sm" />
                      {s.full_name}
                    </span>
                    <div role="radiogroup" aria-label={s.full_name} className="flex gap-1">
                      {MARK_ORDER.map((mark) => {
                        const m = MARKS[mark];
                        const on = marks[s.id] === mark;
                        return (
                          <button
                            key={mark}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            disabled={!editable}
                            title={t(m.label)}
                            onClick={() => setMarks((prev) => ({ ...prev, [s.id]: mark }))}
                            className={clsx('flex h-8 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors disabled:cursor-default', on ? `${m.className} border-current` : 'border-line text-muted hover:bg-canvas')}
                          >
                            <m.icon className="size-3.5" strokeWidth={2.5} aria-hidden />
                            <span className="hidden sm:inline">{t(m.short)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {save.isError && <ErrorNote>{save.error.message}</ErrorNote>}
            <div className="flex flex-wrap justify-between gap-2">
              {!cancelled && can('lesson.cancel') ? (
                <Button variant="ghost" className="!text-danger" onClick={() => setCancelling(true)}>
                  Darsni bekor qilish
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button variant="secondary" onClick={onClose}>
                  Yopish
                </Button>
                {editable && students.length > 0 && (
                  <Button loading={save.isPending} onClick={() => save.mutate()}>
                    {lesson.status === 'completed' ? 'Saqlash' : 'Saqlash va yakunlash'}
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

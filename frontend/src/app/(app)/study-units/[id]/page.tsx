'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, DoorOpen, GraduationCap, Plus, Trash2, UserRound, Users, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ScheduleDialog, StudentPicker } from '@/components/academic';
import { useToast } from '@/components/toast';
import { Avatar, BackButton, Button, ConfirmDialog, EmptyState, ErrorNote, IconButton, Modal, Panel, Select, StatusPill, TableSkeleton, td, th } from '@/components/ui';
import { todayIso, UNIT_STATUS, WEEKDAYS, type Member, type StudyUnit, type UnitStatus } from '@/lib/academic';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMoney, formatPhone, studentNo } from '@/lib/format';
import { t } from '@/lib/i18n';

type Detail = StudyUnit & { members: Member[] };

export default function StudyUnitPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [scheduling, setScheduling] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const unit = useQuery({ queryKey: ['study-units', id], queryFn: () => api<Detail>(`/study-units/${id}`) });
  const refresh = () => Promise.all(['study-units', 'students', 'dashboard'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));

  const setStatus = useMutation({
    mutationFn: (status: UnitStatus) => api<StudyUnit>(`/study-units/${id}`, { method: 'PATCH', body: { status } }),
    onSuccess: async () => {
      await refresh();
      toast.success("Guruh holati o'zgartirildi");
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (m: Member) => api<void>(`/study-units/${id}/members/${m.enrollment_id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await refresh();
      setRemoving(null);
      toast.success("O'quvchi guruhdan chiqarildi");
    },
    onError: (e) => toast.error(e.message),
  });

  if (unit.isPending) return <Panel><TableSkeleton rows={4} /></Panel>;
  if (unit.isError) {
    return (
      <>
        <div className="mb-3">
          <BackButton />
        </div>
        <ErrorNote onRetry={() => void unit.refetch()}>{unit.error.message}</ErrorNote>
      </>
    );
  }
  const g = unit.data;
  const current = g.members.filter((m) => m.active);
  const past = g.members.filter((m) => !m.active);
  const canMembers = can('study_unit.manage_members') && g.status !== 'finished';
  const facts = [
    { icon: GraduationCap, label: 'Fan', value: `${g.discipline.name}${g.level ? ` · ${g.level.name}` : ''}` },
    { icon: UserRound, label: "O'qituvchi", value: g.teacher.full_name },
    { icon: DoorOpen, label: 'Filial / xona', value: `${g.branch.name}${g.classroom ? ` · ${g.classroom.name}` : ''}` },
    { icon: Wallet, label: 'Oylik abonement', value: formatMoney(g.price_amount) },
  ];

  return (
    <>
      <div className="mb-3">
        <BackButton />
      </div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[22px] font-semibold leading-tight tracking-tight">
              <span className="mr-2 rounded-lg bg-brand-soft px-2 py-0.5 tabular-nums text-brand-strong">{g.number}</span>
              {g.name}
            </h1>
            <StatusPill tone={UNIT_STATUS[g.status].tone}>{UNIT_STATUS[g.status].label}</StatusPill>
          </div>
          <p className="mt-1 text-sm text-muted">{t("{n} ta o'quvchi · sig'im {capacity}", { n: g.students_count, capacity: g.capacity })}</p>
        </div>
        {can('study_unit.update') && (
          <Select aria-label={t('Guruh holati')} value={g.status} disabled={setStatus.isPending} onChange={(e) => setStatus.mutate(e.target.value as UnitStatus)}>
            {(Object.keys(UNIT_STATUS) as UnitStatus[]).map((s) => (
              <option key={s} value={s}>
                {t(UNIT_STATUS[s].label)}
              </option>
            ))}
          </Select>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="space-y-4">
          <Panel className="p-5">
            <dl className="space-y-3.5 text-sm">
              {facts.map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex gap-2.5">
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                  <div>
                    <dt className="text-xs text-muted">{t(label)}</dt>
                    <dd className="font-medium">{value}</dd>
                  </div>
                </div>
              ))}
            </dl>
          </Panel>
          <Panel className="p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-semibold">
                <CalendarDays className="size-4 text-muted" aria-hidden /> {t('Dars jadvali')}
              </h2>
              {can('schedule.update') && (
                <Button variant="secondary" size="sm" onClick={() => setScheduling(true)}>
                  {g.schedule ? "O'zgartirish" : "Qo'yish"}
                </Button>
              )}
            </div>
            {g.schedule ? (
              <div className="mt-3 space-y-1.5 text-sm">
                <p className="font-medium">{g.schedule.days.map((d) => t(WEEKDAYS[d - 1] as string)).join(', ')}</p>
                <p className="tabular-nums text-muted">
                  {g.schedule.start_time}–{g.schedule.end_time}
                </p>
                <p className="tabular-nums text-muted">
                  {formatDate(g.schedule.period_start)} – {formatDate(g.schedule.period_end)}
                </p>
                <Link href="/schedule" className="inline-block pt-1 text-[13px] font-medium text-brand hover:text-brand-strong">
                  {t("Jadvalda ko'rish")}
                </Link>
              </div>
            ) : (
              <p className="mt-3 text-sm leading-relaxed text-muted">{t("Jadval qo'yilmagan. Dars kunlari va vaqtini belgilang — darslar o'zi yaratiladi.")}</p>
            )}
          </Panel>
        </div>

        <Panel className="overflow-hidden">
          <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
            <h2 className="font-semibold">{t("O'quvchilar")}</h2>
            {canMembers && (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus className="size-4" aria-hidden /> O'quvchi qo'shish
              </Button>
            )}
          </header>
          {g.members.length === 0 ? (
            <EmptyState icon={Users} title="Guruhda hali o'quvchi yo'q" hint="O'quvchi qo'shing — u shu kundan boshlab darslar ro'yxatida ko'rinadi." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-line bg-canvas/50">
                  <tr>
                    <th className={th}>{t("O'quvchi")}</th>
                    <th className={th}>{t('Telefon')}</th>
                    <th className={th}>{t("Qo'shilgan")}</th>
                    <th className={`${th} text-right`}>{t('Balans')}</th>
                    {canMembers && <th className={th} aria-label={t('Amallar')} />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {[...current, ...past].map((m) => (
                    <tr key={m.enrollment_id} className={m.active ? 'hover:bg-canvas/40' : 'bg-canvas/30 text-muted'}>
                      <td className={td}>
                        <div className="flex items-center gap-3">
                          <Avatar name={m.student.full_name} src={m.student.photo_url} size="sm" />
                          <div className="min-w-0">
                            <Link href={`/students/${m.student.id}`} className="font-medium hover:text-brand-strong">
                              {m.student.full_name}
                            </Link>
                            <p className="text-xs tabular-nums text-muted">
                              {studentNo(m.student.number)}
                              {!m.active && m.end_date && ` · ${t('chiqqan: {date}', { date: formatDate(m.end_date) })}`}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className={`${td} whitespace-nowrap tabular-nums`}>{formatPhone(m.student.phone)}</td>
                      <td className={`${td} whitespace-nowrap tabular-nums`}>{formatDate(m.start_date)}</td>
                      <td className={`${td} whitespace-nowrap text-right tabular-nums ${m.student.balance < 0 ? 'font-medium text-danger' : ''}`}>{formatMoney(m.student.balance)}</td>
                      {canMembers && <td className={`${td} w-12 text-right`}>{m.active && <IconButton label={t('{name}ni guruhdan chiqarish', { name: m.student.full_name })} icon={Trash2} onClick={() => setRemoving(m)} />}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {scheduling && <ScheduleDialog unit={g} onClose={() => setScheduling(false)} />}
      {adding && <AddMember unitId={id} onClose={() => setAdding(false)} />}
      {removing && (
        <ConfirmDialog
          title="Guruhdan chiqarish"
          message={t("{name} «{group}» guruhidan chiqariladi. Davomat va to'lov tarixi saqlanib qoladi.", { name: removing.student.full_name, group: g.name })}
          confirmLabel="Chiqarish"
          danger
          pending={remove.isPending}
          onConfirm={() => remove.mutate(removing)}
          onClose={() => setRemoving(null)}
        />
      )}
    </>
  );
}

function AddMember({ unitId, onClose }: { unitId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [student, setStudent] = useState<Parameters<Parameters<typeof StudentPicker>[0]['onChange']>[0]>(null);
  const [date, setDate] = useState(todayIso());
  const add = useMutation({
    mutationFn: () => api<{ over_capacity: boolean }>(`/study-units/${unitId}/members`, { method: 'POST', body: { student_id: student?.id, start_date: date } }),
    onSuccess: async (r) => {
      await Promise.all(['study-units', 'students', 'dashboard'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      toast.success(r.over_capacity ? "O'quvchi qo'shildi. Diqqat: guruh sig'imidan oshdi" : "O'quvchi guruhga qo'shildi");
      onClose();
    },
  });
  return (
    <Modal title="Guruhga o'quvchi qo'shish" onClose={onClose}>
      <div className="space-y-4">
        <StudentPicker value={student} onChange={setStudent} />
        <div>
          <label htmlFor="member-start" className="mb-1.5 block text-[13px] font-medium">
            {t('Qaysi kundan boshlab')}
          </label>
          <input id="member-start" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/15" />
        </div>
        {add.isError && <ErrorNote>{add.error.message}</ErrorNote>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button loading={add.isPending} disabled={!student || !date} onClick={() => add.mutate()}>
            Qo'shish
          </Button>
        </div>
      </div>
    </Modal>
  );
}

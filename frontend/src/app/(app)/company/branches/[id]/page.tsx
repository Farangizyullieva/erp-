'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Clock, DoorOpen, MapPin, Pencil, Phone, Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { BranchForm, type Branch } from '@/components/branch-form';
import { useToast } from '@/components/toast';
import { Button, ConfirmDialog, EmptyState, ErrorNote, Field, IconButton, Modal, PageHeader, Panel, StatusPill, TableSkeleton, td, th } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatPhone } from '@/lib/format';
import { t } from '@/lib/i18n';

interface Classroom {
  id: string;
  name: string;
  capacity: number;
  equipment: string | null;
  is_active: boolean;
}

export default function BranchPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState(false);
  const [room, setRoom] = useState<Classroom | 'new' | null>(null);

  const branch = useQuery({ queryKey: ['branches', id], queryFn: () => api<Branch>(`/branches/${id}`) });
  const rooms = useQuery({ queryKey: ['branches', id, 'classrooms'], queryFn: () => api<Classroom[]>(`/branches/${id}/classrooms`) });

  const toggle = useMutation({
    mutationFn: (is_active: boolean) => api<Branch>(`/branches/${id}`, { method: 'PATCH', body: { is_active } }),
    onSuccess: async (b) => {
      await queryClient.invalidateQueries({ queryKey: ['branches'] });
      toast.success(b.is_active ? t("Filial faollashtirildi") : t("Filial faolsizlantirildi"));
      setConfirmToggle(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const back = (
    <Link href="/company/branches" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
      <ArrowLeft className="size-4" aria-hidden /> {t("Filiallar")}
    </Link>
  );

  if (branch.isPending) return <Panel><TableSkeleton rows={3} /></Panel>;
  if (branch.isError) {
    return (
      <>
        {back}
        <div className="mt-4">
          <ErrorNote onRetry={() => void branch.refetch()}>{branch.error.message}</ErrorNote>
        </div>
      </>
    );
  }
  const b = branch.data;
  const canManageRooms = can('classroom.manage');
  const addRoom = canManageRooms && (
    <Button size="sm" onClick={() => setRoom('new')}>
      <Plus className="size-4" aria-hidden /> {t("Xona qo'shish")}
    </Button>
  );

  return (
    <>
      <PageHeader
        back={back}
        title={b.name}
        description={t('Qisqartma: {code}', { code: b.code })}
        action={
          can('branch.update') && (
            <>
              <Button variant="secondary" onClick={() => setConfirmToggle(true)}>
                {b.is_active ? t("Faolsizlantirish") : t("Faollashtirish")}
              </Button>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="size-4" aria-hidden /> {t("Tahrirlash")}
              </Button>
            </>
          )
        }
      />

      <div className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Panel className="h-fit p-5">
          <StatusPill tone={b.is_active ? 'success' : 'neutral'}>{b.is_active ? t("Faol") : t("Faol emas")}</StatusPill>
          <dl className="mt-4 space-y-3.5 text-sm">
            {[
              { icon: MapPin, label: 'Manzil', value: b.address },
              { icon: Phone, label: 'Telefon', value: b.phone && formatPhone(b.phone) },
              { icon: Clock, label: 'Ish vaqti', value: b.working_hours },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex gap-2.5">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                <div>
                  <dt className="text-xs text-muted">{t(label)}</dt>
                  <dd className={value ? 'font-medium' : 'text-muted'}>{value || t("Kiritilmagan")}</dd>
                </div>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel className="overflow-hidden">
          <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
            <h2 className="font-semibold">{t("Xonalar")}</h2>
            {addRoom}
          </header>
          {rooms.isPending ? (
            <TableSkeleton rows={3} />
          ) : rooms.isError ? (
            <div className="p-4">
              <ErrorNote onRetry={() => void rooms.refetch()}>{rooms.error.message}</ErrorNote>
            </div>
          ) : rooms.data.length === 0 ? (
            <EmptyState icon={DoorOpen} title={t("Bu filialda hali xona yo'q")} hint={t("Jadval tuzish uchun kamida bitta xona kerak bo'ladi.")} action={addRoom} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-line bg-canvas/50">
                  <tr>
                    <th className={th}>{t("Xona")}</th>
                    <th className={th}>{t("Sig'im")}</th>
                    <th className={th}>{t("Jihozlar")}</th>
                    <th className={th}>{t("Holat")}</th>
                    {canManageRooms && <th className={th} aria-label={t("Amallar")} />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rooms.data.map((r) => (
                    <tr key={r.id} className="hover:bg-canvas/40">
                      <td className={`${td} font-medium`}>{r.name}</td>
                      <td className={td}>{r.capacity} {t('kishi')}</td>
                      <td className={`${td} text-muted`}>{r.equipment ?? '—'}</td>
                      <td className={td}>
                        <StatusPill tone={r.is_active ? 'success' : 'neutral'}>{r.is_active ? t("Faol") : t("Faol emas")}</StatusPill>
                      </td>
                      {canManageRooms && (
                        <td className={`${td} w-12 text-right`}>
                          <IconButton label={t('{name} xonasini tahrirlash', { name: r.name })} icon={Pencil} onClick={() => setRoom(r)} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {editing && <BranchForm branch={b} onClose={() => setEditing(false)} />}
      {room && <ClassroomForm branchId={id} room={room === 'new' ? undefined : room} onClose={() => setRoom(null)} />}
      {confirmToggle && (
        <ConfirmDialog
          title={b.is_active ? t("Filialni faolsizlantirish") : t("Filialni faollashtirish")}
          message={
            b.is_active
              ? t("«{name}» faolsizlantiriladi. Ma'lumotlar o'chmaydi — tarixiy yozuvlar saqlanib qoladi va filialni istalgan payt qayta faollashtirish mumkin.", { name: b.name })
              : t("«{name}» yana faol filiallar ro'yxatiga qaytadi.", { name: b.name })
          }
          confirmLabel={b.is_active ? t("Faolsizlantirish") : t("Faollashtirish")}
          danger={b.is_active}
          pending={toggle.isPending}
          onConfirm={() => toggle.mutate(!b.is_active)}
          onClose={() => setConfirmToggle(false)}
        />
      )}
    </>
  );
}

function ClassroomForm({ branchId, room, onClose }: { branchId: string; room?: Classroom; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [active, setActive] = useState(room?.is_active ?? true);
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      room
        ? api<Classroom>(`/classrooms/${room.id}`, { method: 'PATCH', body })
        : api<Classroom>(`/branches/${branchId}/classrooms`, { method: 'POST', body }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['branches'] });
      toast.success(room ? t("Xona saqlandi") : t("Xona qo'shildi"));
      onClose();
    },
  });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors() : {};
  const duplicate = save.error instanceof ApiError && save.error.code === 'CONFLICT';

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const equipment = String(form.get('equipment') ?? '').trim();
    save.mutate({
      name: String(form.get('name')).trim(),
      capacity: Number(form.get('capacity')),
      ...(equipment ? { equipment } : {}),
      ...(room ? { is_active: active } : {}),
    });
  }

  return (
    <Modal title={room ? t("Xonani tahrirlash") : t("Yangi xona")} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem]">
          <Field
            label={t("Nomi")}
            name="name"
            defaultValue={room?.name}
            placeholder={t("Masalan: 201-xona")}
            required
            autoFocus
            error={errors.name ?? (duplicate ? t("Bu filialda shu nomli xona bor") : undefined)}
          />
          <Field label={t("Sig'im")} name="capacity" type="number" min={1} max={1000} defaultValue={room?.capacity ?? 12} required error={errors.capacity} />
        </div>
        <Field label={t("Jihozlar")} name="equipment" defaultValue={room?.equipment ?? ''} placeholder={t("Proyektor, doska, kompyuterlar")} error={errors.equipment} />
        {room && (
          <label className="flex items-center gap-2.5 text-sm">
            <input type="checkbox" className="size-4 accent-brand" checked={active} onChange={(e) => setActive(e.target.checked)} />
            {t("Xona faol (jadvalda tanlash mumkin)")}
          </label>
        )}
        {save.isError && !duplicate && Object.keys(errors).length === 0 && <ErrorNote>{save.error.message}</ErrorNote>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>
            {t("Bekor qilish")}
          </Button>
          <Button type="submit" loading={save.isPending}>
            {t("Saqlash")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

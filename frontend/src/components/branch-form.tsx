'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { useToast } from '@/components/toast';
import { Button, ErrorNote, Field, Modal } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';

export interface Branch {
  id: string;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  working_hours: string | null;
  timezone: string;
  is_active: boolean;
  classrooms_count: number;
  employees_count: number;
}

export function BranchForm({ branch, onClose }: { branch?: Branch; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: (body: Record<string, string>) =>
      branch ? api<Branch>(`/branches/${branch.id}`, { method: 'PATCH', body }) : api<Branch>('/branches', { method: 'POST', body }),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['branches'] });
      toast.success(branch ? t("Filial ma'lumotlari saqlandi") : t("«{name}» filiali qo'shildi", { name: saved.name }));
      onClose();
    },
  });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors() : {};

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const entries = [...new FormData(e.currentTarget).entries()]
      .map(([k, v]) => [k, String(v).trim()] as const)
      .filter(([, v]) => v !== '');
    save.mutate(Object.fromEntries(entries));
  }

  return (
    <Modal title={branch ? t("Filialni tahrirlash") : t("Yangi filial")} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label={t("Nomi")} name="name" defaultValue={branch?.name} placeholder={t("Masalan: Chilonzor filiali")} required autoFocus error={errors.name} />
        <Field
          label={t("Qisqartma")}
          name="code"
          defaultValue={branch?.code}
          placeholder="CHZ"
          required
          maxLength={10}
          hint={t("Lotin harflari va raqamlar. Guruh nomlarida ishlatiladi")}
          error={errors.code}
        />
        <Field label={t("Manzil")} name="address" defaultValue={branch?.address ?? ''} error={errors.address} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Telefon")} name="phone" type="tel" defaultValue={branch?.phone ?? ''} placeholder="+998 90 123-45-67" error={errors.phone} />
          <Field label={t("Ish vaqti")} name="working_hours" defaultValue={branch?.working_hours ?? ''} placeholder="09:00–21:00" error={errors.working_hours} />
        </div>
        {save.isError && Object.keys(errors).length === 0 && <ErrorNote>{save.error.message}</ErrorNote>}
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

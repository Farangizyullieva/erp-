'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useToast } from '@/components/toast';
import { Button, CheckCard, Drawer, ErrorNote, Field, SelectField, TextareaField } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { GENDER, RELATIONS, type DictionaryItem, type Ref, type Student } from '@/lib/students';
import { t } from '@/lib/i18n';

const legend = 'mb-3 text-xs font-semibold uppercase tracking-wide text-muted';

/** Yaratishda — minimal forma (TZ P6); tahrirlashda — to'liq */
export function StudentForm({ student, onClose }: { student?: Student; onClose: () => void }) {
  const { can } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [withContact, setWithContact] = useState(false);
  const [blacklisted, setBlacklisted] = useState(student?.blacklisted ?? false);
  const [duplicate, setDuplicate] = useState<{ names: string; body: Record<string, unknown> } | null>(null);

  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<(Ref & { is_active: boolean })[]>('/branches') });
  const dictionaries = useQuery({ queryKey: ['dictionaries', 'active'], queryFn: () => api<DictionaryItem[]>('/dictionaries') });
  const owners = useQuery({ queryKey: ['employees', 'options'], queryFn: () => api<{ id: string; full_name: string }[]>('/employees/options') });
  const activeBranches = (branches.data ?? []).filter((b) => b.is_active || b.id === student?.branch.id);
  const ofKind = (kind: string): DictionaryItem[] => (dictionaries.data ?? []).filter((d) => d.kind === kind);
  const contactsEditable = !student || !student.contacts_hidden;

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      student ? api<Student>(`/students/${student.id}`, { method: 'PATCH', body }) : api<Student>('/students', { method: 'POST', body }),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['students'] });
      toast.success(student ? t("O'quvchi ma'lumotlari saqlandi") : t("{name} qo'shildi", { name: saved.full_name }));
      onClose();
      if (!student) router.push(`/students/${saved.id}`);
    },
    onError: (e, body) => {
      if (e instanceof ApiError && e.code === 'POSSIBLE_DUPLICATE') setDuplicate({ names: e.details[0]?.message ?? '', body });
    },
  });
  const apiError = save.error instanceof ApiError && save.error.code !== 'POSSIBLE_DUPLICATE' ? save.error : null;
  const errors = apiError?.fieldErrors() ?? {};

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = (name: string): string => String(form.get(name) ?? '').trim();
    const body: Record<string, unknown> = {
      full_name: text('full_name'),
      branch_id: text('branch_id'),
      birth_date: text('birth_date'),
      gender: text('gender'),
      owner_id: text('owner_id'),
      ad_source_id: text('ad_source_id'),
      learning_goal_id: text('learning_goal_id'),
      note: text('note'),
    };
    if (contactsEditable) {
      body.phone = text('phone');
      body.email = text('email');
    }
    if (student) {
      body.blacklisted = blacklisted;
      body.blacklist_reason = blacklisted ? text('blacklist_reason') : '';
    } else if (withContact && text('contact_name')) {
      body.contact = { full_name: text('contact_name'), relation: text('contact_relation'), phone: text('contact_phone') };
    }
    setDuplicate(null);
    save.mutate(body);
  }

  return (
    <Drawer
      title={student ? t("O'quvchini tahrirlash") : t("Yangi o'quvchi")}
      description={student ? student.full_name : t("Faqat ism va filial majburiy — qolganini keyin to'ldirish mumkin")}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("Bekor qilish")}
          </Button>
          <Button type="submit" form="student-form" loading={save.isPending}>
            {t("Saqlash")}
          </Button>
        </>
      }
    >
      <form id="student-form" onSubmit={onSubmit} className="space-y-6">
        <fieldset className="space-y-4">
          <legend className={legend}>{t("Asosiy ma'lumot")}</legend>
          <Field label={t("F.I.O.")} name="full_name" defaultValue={student?.full_name} placeholder={t("Familiya Ism")} required minLength={2} autoFocus error={errors.full_name} />
          {contactsEditable && (
            <Field label={t("Telefon")} name="phone" type="tel" defaultValue={student?.phone ?? ''} placeholder="+998 90 123-45-67" error={errors.phone} />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("Tug'ilgan sana")} name="birth_date" type="date" defaultValue={student?.birth_date ?? ''} error={errors.birth_date} />
            <SelectField label={t("Jinsi")} name="gender" defaultValue={student?.gender ?? ''}>
              <option value="">{t("Ko'rsatilmagan")}</option>
              {Object.entries(GENDER).map(([value, label]) => (
                <option key={value} value={value}>
                  {t(label)}
                </option>
              ))}
            </SelectField>
          </div>
          <SelectField label={t("Filial")} name="branch_id" required defaultValue={student?.branch.id ?? (activeBranches.length === 1 ? activeBranches[0]?.id : '')} key={activeBranches.length} error={errors.branch_id}>
            {activeBranches.length !== 1 && <option value="">{t("Tanlang…")}</option>}
            {activeBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </SelectField>
          {student && contactsEditable && (
            <Field label={t("Email")} name="email" type="email" defaultValue={student.email ?? ''} placeholder="ism@example.com" error={errors.email} />
          )}
        </fieldset>

        {!student && (
          <fieldset className="space-y-4">
            <legend className={legend}>{t("Ota-ona yoki vakil")}</legend>
            <CheckCard
              title={t("Aloqa shaxsini qo'shish")}
              description={t("Voyaga yetmagan o'quvchi uchun schyot va xabarlar shu shaxsga boradi")}
              checked={withContact}
              onChange={setWithContact}
            />
            {withContact && (
              <div className="space-y-4 rounded-lg bg-canvas/70 p-3.5">
                <Field label={t("F.I.O.")} name="contact_name" placeholder={t("Familiya Ism")} required minLength={2} error={errors['contact.full_name']} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField label={t("Kim bo'ladi")} name="contact_relation" defaultValue="Ona">
                    {RELATIONS.map((r) => (
                      <option key={r} value={r}>
                        {t(r)}
                      </option>
                    ))}
                  </SelectField>
                  <Field label={t("Telefon")} name="contact_phone" type="tel" placeholder="+998 90 123-45-67" error={errors['contact.phone']} />
                </div>
              </div>
            )}
          </fieldset>
        )}

        <fieldset className="space-y-4">
          <legend className={legend}>{t("Qo'shimcha")}</legend>
          <SelectField label={t("Mas'ul xodim")} name="owner_id" defaultValue={student?.owner?.id ?? ''} key={`o${owners.data?.length}`} error={errors.owner_id}>
            <option value="">{t("Biriktirilmagan")}</option>
            {owners.data?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.full_name}
              </option>
            ))}
          </SelectField>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label={t("Qayerdan bildi")} name="ad_source_id" defaultValue={student?.ad_source?.id ?? ''} key={`s${dictionaries.data?.length}`}>
              <option value="">{t("Ko'rsatilmagan")}</option>
              {ofKind('ad_source').map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </SelectField>
            <SelectField label={t("O'qish maqsadi")} name="learning_goal_id" defaultValue={student?.learning_goal?.id ?? ''} key={`g${dictionaries.data?.length}`}>
              <option value="">{t("Ko'rsatilmagan")}</option>
              {ofKind('learning_goal').map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </SelectField>
          </div>
          <TextareaField label={t("Ichki izoh")} name="note" defaultValue={student?.note ?? ''} maxLength={2000} hint={t("Faqat xodimlar ko'radi")} />
        </fieldset>

        {student && can('student.update') && (
          <fieldset className="space-y-4">
            <legend className={legend}>{t("Qora ro'yxat")}</legend>
            <CheckCard title={t("Qora ro'yxatga kiritish")} description={t("Kartochkada va ro'yxatda ogohlantirish belgisi ko'rinadi")} checked={blacklisted} onChange={setBlacklisted} />
            {blacklisted && <Field label={t("Sababi")} name="blacklist_reason" defaultValue={student.blacklist_reason ?? ''} maxLength={500} required />}
          </fieldset>
        )}

        {duplicate && (
          <div role="alert" className="rounded-lg border border-warning/30 bg-warning-soft p-3.5">
            <p className="flex items-center gap-2 text-sm font-medium text-warning">
              <TriangleAlert className="size-4 shrink-0" aria-hidden /> {t("Bu telefon raqami allaqachon bor")}
            </p>
            <p className="mt-1.5 text-sm text-ink/80">
              {t("Shu raqam bilan yozilgan:")} <b className="font-medium">{duplicate.names}</b>. Agar bu boshqa odam bo'lsa (masalan, aka-uka), baribir qo'shishingiz mumkin.
            </p>
            <Button variant="secondary" size="sm" className="mt-3" loading={save.isPending} onClick={() => save.mutate({ ...duplicate.body, confirm_duplicate: true })}>
              {t("Baribir qo'shish")}
            </Button>
          </div>
        )}
        {apiError && Object.keys(errors).length === 0 && <ErrorNote>{apiError.message}</ErrorNote>}
      </form>
    </Drawer>
  );
}

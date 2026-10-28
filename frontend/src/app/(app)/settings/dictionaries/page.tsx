'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, BookOpen, CalendarOff, Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useToast } from '@/components/toast';
import { Button, ConfirmDialog, EmptyState, ErrorNote, IconButton, PageHeader, Panel, StatusPill, TableSkeleton, Tabs } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { t } from '@/lib/i18n';

const KINDS = [
  { id: 'discipline', label: 'Fanlar', hint: "O'qitiladigan yo'nalishlar: Backend, Ingliz tili…", placeholder: 'Masalan: Matematika' },
  { id: 'level', label: 'Darajalar', hint: 'Bilim darajalari: Beginner, A1, Junior…', placeholder: 'Masalan: B2' },
  { id: 'age_category', label: 'Yosh toifalari', hint: "Guruhlar yosh bo'yicha ajratiladi", placeholder: 'Masalan: Bolalar 7–10' },
  { id: 'study_unit_type', label: 'Guruh turlari', hint: 'Standart, Intensiv, Online…', placeholder: 'Masalan: Intensiv' },
  { id: 'ad_source', label: 'Reklama manbalari', hint: 'Mijoz biz haqimizda qayerdan bilgani', placeholder: 'Masalan: Instagram' },
  { id: 'learning_goal', label: "O'qish maqsadlari", hint: "O'quvchi nima uchun o'qimoqchi", placeholder: 'Masalan: Kasb egallash' },
  { id: 'cancel_reason', label: 'Bekor qilish sabablari', hint: 'Dars bekor qilinganda tanlanadi', placeholder: "Masalan: O'qituvchi kasal" },
  { id: 'holidays', label: 'Bayramlar', hint: '', placeholder: '' },
] as const;
type TabId = (typeof KINDS)[number]['id'];

interface Item {
  id: string;
  kind: string;
  name: string;
  is_active: boolean;
}

const fieldError = (e: unknown): string | null =>
  e instanceof ApiError ? (e.details[0]?.message ?? e.message) : e instanceof Error ? e.message : null;

export default function DictionariesPage() {
  const [tab, setTab] = useState<TabId>('discipline');
  const items = useQuery({ queryKey: ['dictionaries', 'all'], queryFn: () => api<Item[]>('/dictionaries?include_inactive=true') });
  const kind = KINDS.find((k) => k.id === tab) ?? KINDS[0];
  const countOf = (id: string): number | undefined => items.data?.filter((i) => i.kind === id && i.is_active).length;

  return (
    <>
      <PageHeader title={t("Ma'lumotnomalar")} description={t("Formalardagi tanlov ro'yxatlari shu yerdan boshqariladi")} />
      <Tabs tabs={KINDS.map((k) => ({ id: k.id, label: k.label, count: k.id === 'holidays' ? undefined : countOf(k.id) }))} value={tab} onChange={setTab} />
      <div className="mt-5 max-w-2xl">
        {tab === 'holidays' ? (
          <Holidays />
        ) : items.isPending ? (
          <Panel>
            <TableSkeleton />
          </Panel>
        ) : items.isError ? (
          <ErrorNote onRetry={() => void items.refetch()}>{items.error.message}</ErrorNote>
        ) : (
          <ItemList key={tab} kind={kind} items={items.data.filter((i) => i.kind === tab)} />
        )}
      </div>
    </>
  );
}

function ItemList({ kind, items }: { kind: (typeof KINDS)[number]; items: Item[] }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['dictionaries'] });

  const create = useMutation({
    mutationFn: () => api<Item>('/dictionaries', { method: 'POST', body: { kind: kind.id, name } }),
    onSuccess: async (item) => {
      await refresh();
      setName('');
      toast.success(t("«{name}» qo'shildi", { name: item.name }));
    },
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; is_active?: boolean }) => api<Item>(`/dictionaries/${id}`, { method: 'PATCH', body }),
    onSuccess: async (item, vars) => {
      await refresh();
      setEditing(null);
      toast.success(vars.is_active === undefined ? t("Saqlandi") : t(item.is_active ? '«{name}» qaytarildi' : '«{name}» arxivlandi', { name: item.name }));
    },
    onError: (e) => toast.error(fieldError(e) ?? t("Xatolik")),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) create.mutate();
  };

  return (
    <Panel>
      <form onSubmit={submit} className="border-b border-line p-4">
        <p className="mb-3 text-sm text-muted">{t(kind.hint)}</p>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              create.reset();
            }}
            placeholder={t(kind.placeholder)}
            aria-label={t("Yangi yozuv nomi")}
            maxLength={100}
            className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/15"
          />
          <Button type="submit" className="h-10" loading={create.isPending} disabled={!name.trim()}>
            <Plus className="size-4" aria-hidden /> {t("Qo'shish")}
          </Button>
        </div>
        {create.isError && <p className="mt-2 text-xs text-danger">{fieldError(create.error)}</p>}
      </form>

      {items.length === 0 ? (
        <EmptyState icon={BookOpen} title={t("Hali yozuv yo'q")} hint={t("Yuqoridagi maydonga nom yozib, birinchisini qo'shing.")} />
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <li key={item.id} className="flex min-h-[52px] items-center gap-2 px-4 py-1.5">
              {editing?.id === item.id ? (
                <form
                  className="flex flex-1 items-center gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (editing.name.trim()) update.mutate({ id: item.id, name: editing.name.trim() });
                  }}
                >
                  <input
                    autoFocus
                    value={editing.name}
                    onChange={(e) => setEditing({ id: item.id, name: e.target.value })}
                    onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
                    aria-label={t("Nomi")}
                    maxLength={100}
                    className="h-9 min-w-0 flex-1 rounded-lg border border-brand bg-surface px-2.5 text-sm focus:outline-none focus:ring-3 focus:ring-brand/15"
                  />
                  <IconButton type="submit" label={t("Saqlash")} icon={Check} className="text-brand" />
                  <IconButton label={t("Bekor qilish")} icon={X} onClick={() => setEditing(null)} />
                </form>
              ) : (
                <>
                  <span className={item.is_active ? 'flex-1 text-sm font-medium' : 'flex-1 text-sm text-muted line-through'}>{item.name}</span>
                  {!item.is_active && <StatusPill tone="neutral">{t("Arxivda")}</StatusPill>}
                  {item.is_active && <IconButton label={t("«{name}» nomini o'zgartirish", { name: item.name })} icon={Pencil} onClick={() => setEditing({ id: item.id, name: item.name })} />}
                  <IconButton
                    label={item.is_active ? t("Arxivlash") : t("Qaytarish")}
                    icon={item.is_active ? Archive : ArchiveRestore}
                    onClick={() => update.mutate({ id: item.id, is_active: !item.is_active })}
                  />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-line px-4 py-3 text-xs text-muted">
        {t("Yozuvlar o'chirilmaydi — arxivlanadi: eski ma'lumotlarda saqlanib qoladi, lekin yangi formalarda chiqmaydi.")}
      </p>
    </Panel>
  );
}

interface Holiday {
  id: string;
  date: string;
  name: string;
}

function Holidays() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [year, setYear] = useState(new Date().getFullYear());
  const [removing, setRemoving] = useState<Holiday | null>(null);
  const holidays = useQuery({ queryKey: ['holidays', year], queryFn: () => api<Holiday[]>(`/holidays?year=${year}`) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['holidays'] });

  const create = useMutation({
    mutationFn: (body: { date: string; name: string }) => api<Holiday>('/holidays', { method: 'POST', body }),
    onSuccess: async (h) => {
      await refresh();
      setYear(Number(h.date.slice(0, 4)));
      toast.success(t("«{name}» qo'shildi", { name: h.name }));
    },
  });
  const remove = useMutation({
    mutationFn: (h: Holiday) => api<void>(`/holidays/${h.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await refresh();
      setRemoving(null);
      toast.success("Bayram o'chirildi");
    },
    onError: (e) => toast.error(e.message),
  });

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    create.mutate({ date: String(data.get('date')), name: String(data.get('name')).trim() }, { onSuccess: () => form.reset() });
  };
  const input = 'h-10 rounded-lg border border-line bg-surface px-3 text-sm placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/15';

  return (
    <Panel>
      <form onSubmit={submit} className="border-b border-line p-4">
        <p className="mb-3 text-sm text-muted">{t("Bayram kunlarida darslar jadvalga avtomatik qo'yilmaydi")}</p>
        <div className="flex flex-wrap gap-2">
          <input type="date" name="date" required aria-label={t("Sana")} className={input} />
          <input name="name" required maxLength={100} placeholder={t("Masalan: Navro'z")} aria-label={t("Bayram nomi")} className={`${input} min-w-40 flex-1`} />
          <Button type="submit" className="h-10" loading={create.isPending}>
            <Plus className="size-4" aria-hidden /> {t("Qo'shish")}
          </Button>
        </div>
        {create.isError && <p className="mt-2 text-xs text-danger">{fieldError(create.error)}</p>}
      </form>

      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="text-sm font-medium">{t("{year}-yil", { year })}</span>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setYear((y) => y - 1)}>
            ‹ {year - 1}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setYear((y) => y + 1)}>
            {year + 1} ›
          </Button>
        </div>
      </div>

      {holidays.isPending ? (
        <TableSkeleton rows={3} />
      ) : holidays.isError ? (
        <div className="p-4">
          <ErrorNote onRetry={() => void holidays.refetch()}>{holidays.error.message}</ErrorNote>
        </div>
      ) : holidays.data.length === 0 ? (
        <EmptyState icon={CalendarOff} title={t('{year}-yil uchun bayram kiritilmagan', { year })} hint={t("Sana va nomni kiritib, bayram qo'shing.")} />
      ) : (
        <ul className="divide-y divide-line">
          {holidays.data.map((h) => (
            <li key={h.id} className="flex min-h-[52px] items-center gap-3 px-4 py-1.5">
              <span className="w-24 shrink-0 text-sm tabular-nums text-muted">{formatDate(h.date)}</span>
              <span className="flex-1 text-sm font-medium">{h.name}</span>
              <IconButton label={t("«{name}»ni o'chirish", { name: h.name })} icon={Trash2} onClick={() => setRemoving(h)} />
            </li>
          ))}
        </ul>
      )}
      {removing && (
        <ConfirmDialog
          title={t("Bayramni o'chirish")}
          message={t("«{name}» ({date}) bayramlar ro'yxatidan o'chiriladi.", { name: removing.name, date: formatDate(removing.date) })}
          confirmLabel={t("O'chirish")}
          danger
          pending={remove.isPending}
          onConfirm={() => remove.mutate(removing)}
          onClose={() => setRemoving(null)}
        />
      )}
    </Panel>
  );
}

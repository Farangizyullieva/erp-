'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, Copy, Lock, Minus, Plus } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useToast } from '@/components/toast';
import { Button, ErrorNote, Field, Modal, PageHeader, Panel, TableSkeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { permissionLabel, SCOPE_LABELS, type Scope } from '@/lib/permission-labels';
import { t } from '@/lib/i18n';

interface Role {
  id: string;
  code: string;
  name: string;
  is_system: boolean;
  users_count: number;
  permissions: { code: string; scope: Scope }[];
}

interface Group {
  group: string;
  permissions: string[];
}

type Draft = Record<string, Scope>;
const toDraft = (role: Role): Draft => Object.fromEntries(role.permissions.map((p) => [p.code, p.scope]));

function Box({ state }: { state: 'on' | 'off' | 'mixed' }) {
  return (
    <span
      aria-hidden
      className={clsx(
        'grid size-[18px] shrink-0 place-items-center rounded-[5px] border peer-focus-visible:ring-3 peer-focus-visible:ring-brand/30',
        state === 'off' ? 'border-muted/50 bg-surface' : 'border-brand bg-brand text-white',
      )}
    >
      {state === 'on' && <Check className="size-3.5" strokeWidth={3} />}
      {state === 'mixed' && <Minus className="size-3.5" strokeWidth={3} />}
    </span>
  );
}

export default function RolesPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<Role[]>('/roles') });
  const catalog = useQuery({ queryKey: ['permissions'], queryFn: () => api<Group[]>('/permissions'), staleTime: Infinity });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ copyFrom?: Role } | null>(null);
  const selected = roles.data?.find((r) => r.id === selectedId) ?? roles.data?.[0];
  const [draft, setDraft] = useState<Draft>({});

  // Boshqa rol tanlanganda yoki serverdan yangilanganda qoralama qayta boshlanadi
  useEffect(() => {
    if (selected) setDraft(toDraft(selected));
  }, [selected]);

  const dirty = useMemo(() => {
    if (!selected) return false;
    const saved = toDraft(selected);
    const keys = new Set([...Object.keys(saved), ...Object.keys(draft)]);
    return [...keys].some((k) => saved[k] !== draft[k]);
  }, [selected, draft]);

  const save = useMutation({
    mutationFn: (role: Role) =>
      api<Role>(`/roles/${role.id}/permissions`, {
        method: 'PUT',
        body: { permissions: Object.entries(draft).map(([code, scope]) => ({ code, scope })) },
      }),
    onSuccess: async (role) => {
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast.success(t('«{name}» roli ruxsatlari saqlandi', { name: t(role.name) }));
    },
    onError: (e) => toast.error(e.message),
  });

  if (roles.isPending || catalog.isPending) {
    return (
      <>
        <PageHeader title={t("Rollar va ruxsatlar")} />
        <Panel>
          <TableSkeleton rows={6} />
        </Panel>
      </>
    );
  }
  if (roles.isError || catalog.isError) {
    return (
      <>
        <PageHeader title={t("Rollar va ruxsatlar")} />
        <ErrorNote onRetry={() => void Promise.all([roles.refetch(), catalog.refetch()])}>
          {(roles.error ?? catalog.error)?.message}
        </ErrorNote>
      </>
    );
  }
  if (!selected) return null;

  const locked = selected.code === 'owner';
  const defaultScope: Scope = selected.permissions[0]?.scope ?? 'all';
  const setMany = (codes: string[], on: boolean) =>
    setDraft((d) => {
      const next = { ...d };
      for (const code of codes) {
        if (on) next[code] ??= defaultScope;
        else delete next[code];
      }
      return next;
    });
  const selectRole = (role: Role) => {
    if (dirty && !window.confirm(t("Saqlanmagan o'zgarishlar bor. Boshqa rolga o'tilsinmi?"))) return;
    setSelectedId(role.id);
  };

  return (
    <>
      <PageHeader
        title={t("Rollar va ruxsatlar")}
        description={t("Har bir rol tizimda nimalarni ko'rishi va qila olishini belgilang")}
        action={
          <Button onClick={() => setCreating({})}>
            <Plus className="size-4" aria-hidden /> {t("Rol qo'shish")}
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <Panel className="h-fit p-1.5">
          <ul>
            {roles.data.map((role) => (
              <li key={role.id}>
                <button
                  type="button"
                  onClick={() => selectRole(role)}
                  aria-current={role.id === selected.id || undefined}
                  className={clsx(
                    'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left',
                    role.id === selected.id ? 'bg-brand-soft text-brand-strong' : 'hover:bg-canvas',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{t(role.name)}</span>
                    <span className={clsx('block text-xs', role.id === selected.id ? 'text-brand-strong/75' : 'text-muted')}>
                      {t('{users} ta xodim · {perms} ta ruxsat', { users: role.users_count, perms: role.permissions.length })}
                    </span>
                  </span>
                  {role.code === 'owner' && <Lock className="size-3.5 shrink-0" aria-label={t("O'zgartirib bo'lmaydi")} />}
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <div className="min-w-0">
          <Panel>
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
              <div>
                <h2 className="font-semibold">{t(selected.name)}</h2>
                <p className="mt-0.5 text-[13px] text-muted">
                  {locked
                    ? t("Tashkilot egasi har doim barcha ruxsatlarga ega — bu rolni o'zgartirib bo'lmaydi")
                    : t('{n} ta ruxsat tanlangan', { n: Object.keys(draft).length })}
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setCreating({ copyFrom: selected })}>
                <Copy className="size-4" aria-hidden /> {t("Nusxa olish")}
              </Button>
            </header>

            <div className="divide-y divide-line">
              {catalog.data.map(({ group, permissions }) => {
                const on = permissions.filter((code) => draft[code]).length;
                const state = on === 0 ? 'off' : on === permissions.length ? 'on' : 'mixed';
                return (
                  <fieldset key={group} disabled={locked} className="px-5 py-4">
                    <legend className="contents">
                      <label className="mb-3 flex w-fit items-center gap-2.5">
                        <input
                          type="checkbox"
                          className="peer sr-only"
                          checked={state === 'on'}
                          onChange={() => setMany(permissions, state !== 'on')}
                          aria-label={t('{name}: hammasini tanlash', { name: t(group) })}
                        />
                        <Box state={state} />
                        <span className="text-sm font-semibold">{t(group)}</span>
                        <span className="text-xs text-muted">
                          {on}/{permissions.length}
                        </span>
                      </label>
                    </legend>
                    <ul className="grid gap-x-6 gap-y-1 md:grid-cols-2">
                      {permissions.map((code) => {
                        const scope = draft[code];
                        return (
                          <li key={code} className="flex min-h-9 items-center justify-between gap-2">
                            <label className={clsx('flex min-w-0 items-center gap-2.5 text-sm', locked && 'cursor-default')}>
                              <input type="checkbox" className="peer sr-only" checked={Boolean(scope)} onChange={(e) => setMany([code], e.target.checked)} />
                              <Box state={scope ? 'on' : 'off'} />
                              <span className={clsx('truncate', !scope && 'text-muted')}>{permissionLabel(code)}</span>
                            </label>
                            {scope && (
                              <select
                                value={scope}
                                onChange={(e) => setDraft((d) => ({ ...d, [code]: e.target.value as Scope }))}
                                aria-label={t('{name}: doira', { name: permissionLabel(code) })}
                                className="h-7 shrink-0 rounded-md border border-line bg-surface px-1.5 text-xs text-muted disabled:opacity-60"
                              >
                                {(Object.keys(SCOPE_LABELS) as Scope[]).map((s) => (
                                  <option key={s} value={s}>
                                    {t(SCOPE_LABELS[s])}
                                  </option>
                                ))}
                              </select>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </fieldset>
                );
              })}
            </div>
          </Panel>

          {dirty && !locked && (
            <div className="sticky bottom-4 z-10 mt-4 flex animate-in items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-pop">
              <p className="text-sm font-medium">{t("Saqlanmagan o'zgarishlar bor")}</p>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setDraft(toDraft(selected))}>
                  {t("Bekor qilish")}
                </Button>
                <Button loading={save.isPending} onClick={() => save.mutate(selected)}>
                  {t("Saqlash")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {creating && <RoleForm copyFrom={creating.copyFrom} onClose={() => setCreating(null)} onCreated={(role) => setSelectedId(role.id)} />}
    </>
  );
}

const LATIN: Record<string, string> = { "'": '', 'ʻ': '', '’': '', ' ': '_', '-': '_' };
const toCode = (name: string): string => {
  const slug = [...name.toLowerCase()].map((ch) => LATIN[ch] ?? ch).join('').replace(/[^a-z0-9_]/g, '').replace(/^[^a-z]+/, '').slice(0, 30);
  return `${slug.length >= 2 ? slug : 'role'}_${Math.random().toString(36).slice(2, 6)}`;
};

function RoleForm({ copyFrom, onClose, onCreated }: { copyFrom?: Role; onClose: () => void; onCreated: (role: Role) => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const create = useMutation({
    mutationFn: (name: string) =>
      api<Role>('/roles', { method: 'POST', body: { name, code: toCode(name), ...(copyFrom ? { copy_from_role_id: copyFrom.id } : {}) } }),
    onSuccess: async (role) => {
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast.success(t('«{name}» roli yaratildi', { name: role.name }));
      onCreated(role);
      onClose();
    },
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    create.mutate(String(new FormData(e.currentTarget).get('name')).trim());
  }

  return (
    <Modal
      title={copyFrom ? t("Roldan nusxa olish") : t("Yangi rol")}
      description={copyFrom ? t("«{name}» rolining barcha ruxsatlari yangi rolga ko'chiriladi", { name: t(copyFrom.name) }) : t("Rol bo'sh yaratiladi — ruxsatlarni keyin belgilaysiz")}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label={t("Rol nomi")} name="name" defaultValue={copyFrom ? t('{name} (nusxa)', { name: t(copyFrom.name) }) : ''} placeholder={t("Masalan: Katta administrator")} required minLength={2} maxLength={100} autoFocus />
        {create.isError && <ErrorNote>{create.error.message}</ErrorNote>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>
            {t("Bekor qilish")}
          </Button>
          <Button type="submit" loading={create.isPending}>
            {t("Yaratish")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

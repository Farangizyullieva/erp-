'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Pencil, Plus, ShieldCheck, UserCheck, UserX, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useToast } from '@/components/toast';
import {
  Avatar, Button, CheckCard, ConfirmDialog, Drawer, EmptyState, ErrorNote, Field, IconButton, PageHeader, Panel,
  SearchInput, Select, StatusPill, TableSkeleton, Tag, td, th,
} from '@/components/ui';
import { api, ApiError, apiPage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatPhone } from '@/lib/format';
import { useNewParam } from '@/lib/use-new-param';
import { t } from '@/lib/i18n';

interface Ref {
  id: string;
  name: string;
  code: string;
}

interface Employee {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  is_active: boolean;
  photo_url: string | null;
  last_login_at: string | null;
  roles: Ref[];
  branches: Ref[];
}

// Kabinet rollari xodimga berilmaydi
const PORTAL_ROLES = ['student', 'parent'];

export default function EmployeesPage() {
  return (
    <Suspense>
      <Employees />
    </Suspense>
  );
}

function Employees() {
  const { me, can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // Filtr holati URL'da — havolani hamkasbga yuborish mumkin (TZ P1)
  const filters = { q: params.get('q') ?? '', status: params.get('status') ?? '', role: params.get('role') ?? '', branch: params.get('branch') ?? '' };
  const setFilter = (key: keyof typeof filters, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(next.size ? `${pathname}?${next.toString()}` : pathname, { scroll: false });
  };

  const [search, setSearch] = useState(filters.q);
  useEffect(() => {
    if (search === filters.q) return;
    const timer = setTimeout(() => setFilter('q', search.trim()), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const [form, setForm] = useState<Employee | 'new' | null>(null);
  useNewParam(() => can('employee.create') && setForm('new'));
  const [toggling, setToggling] = useState<Employee | null>(null);

  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<Ref[]>('/roles') });
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<Ref[]>('/branches'), enabled: can('branch.view') });
  const staffRoles = (roles.data ?? []).filter((r) => !PORTAL_ROLES.includes(r.code));

  const query = new URLSearchParams({ limit: '30', with_total: 'true' });
  if (filters.q) query.set('q', filters.q);
  if (filters.status) query.set('filter[is_active]', String(filters.status === 'active'));
  if (filters.role) query.set('filter[role_id]', filters.role);
  if (filters.branch) query.set('filter[branch_id]', filters.branch);

  const employees = useInfiniteQuery({
    queryKey: ['employees', 'list', filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams(query);
      if (pageParam) {
        qs.set('cursor', pageParam);
        qs.delete('with_total');
      }
      return apiPage<Employee>(`/employees?${qs.toString()}`);
    },
    getNextPageParam: (last) => last.meta.next_cursor,
  });
  const rows = employees.data?.pages.flatMap((p) => p.data) ?? [];
  const total = employees.data?.pages[0]?.meta.total;
  const filtered = Boolean(filters.q || filters.status || filters.role || filters.branch);

  const toggle = useMutation({
    mutationFn: (e: Employee) => api<Employee>(`/employees/${e.id}/${e.is_active ? 'deactivate' : 'activate'}`, { method: 'POST' }),
    onSuccess: async (e) => {
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
      toast.success(t(e.is_active ? '{name} faollashtirildi' : '{name} faolsizlantirildi', { name: e.full_name }));
      setToggling(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const addButton = can('employee.create') && (
    <Button onClick={() => setForm('new')}>
      <Plus className="size-4" aria-hidden /> {t("Xodim qo'shish")}
    </Button>
  );
  const clearFilters = () => {
    setSearch('');
    router.replace(pathname, { scroll: false });
  };

  return (
    <>
      <PageHeader
        title={t("Xodimlar")}
        description={total === undefined ? t("Tizimga kiruvchi xodimlar va ularning rollari") : t('Jami: {n} ta xodim', { n: total })}
        action={
          <>
            {can('role.manage') && (
              <Link href="/settings/roles" className="inline-flex h-9.5 items-center gap-2 rounded-lg border border-line bg-surface px-3.5 text-sm font-medium hover:bg-canvas">
                <ShieldCheck className="size-4" aria-hidden /> {t('Rollar va ruxsatlar')}
              </Link>
            )}
            {addButton}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchInput value={search} onChange={setSearch} placeholder={t("Ism, telefon yoki email")} />
        <Select aria-label={t("Holat")} value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
          <option value="">{t("Barcha holatlar")}</option>
          <option value="active">{t("Faol")}</option>
          <option value="inactive">{t("Faol emas")}</option>
        </Select>
        <Select aria-label={t("Rol")} value={filters.role} onChange={(e) => setFilter('role', e.target.value)}>
          <option value="">{t("Barcha rollar")}</option>
          {staffRoles.map((r) => (
            <option key={r.id} value={r.id}>
              {t(r.name)}
            </option>
          ))}
        </Select>
        {(branches.data?.length ?? 0) > 1 && (
          <Select aria-label={t("Filial")} value={filters.branch} onChange={(e) => setFilter('branch', e.target.value)}>
            <option value="">{t("Barcha filiallar")}</option>
            {branches.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
        {filtered && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            {t("Tozalash")}
          </Button>
        )}
      </div>

      <Panel className="overflow-hidden">
        {employees.isPending ? (
          <TableSkeleton />
        ) : employees.isError ? (
          <div className="p-4">
            <ErrorNote onRetry={() => void employees.refetch()}>{employees.error.message}</ErrorNote>
          </div>
        ) : rows.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={Users}
              title={t("Hech narsa topilmadi")}
              hint={t("Qidiruv so'zini yoki filtrlarni o'zgartirib ko'ring.")}
              action={
                <Button variant="secondary" onClick={clearFilters}>
                  {t("Filtrni tozalash")}
                </Button>
              }
            />
          ) : (
            <EmptyState icon={Users} title={t("Hali xodim yo'q")} hint={t("Xodim qo'shing va unga rol bering.")} action={addButton} />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line bg-canvas/50">
                <tr>
                  <th className={th}>{t("Xodim")}</th>
                  <th className={th}>{t("Telefon")}</th>
                  <th className={th}>{t("Rollar")}</th>
                  <th className={th}>{t("Filiallar")}</th>
                  <th className={th}>{t("Oxirgi kirish")}</th>
                  <th className={th}>{t("Holat")}</th>
                  <th className={th} aria-label={t("Amallar")} />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((e) => (
                  <tr key={e.id} className="hover:bg-canvas/40">
                    <td className={td}>
                      <div className="flex items-center gap-3">
                        <Avatar name={e.full_name} src={e.photo_url} />
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {e.full_name}
                            {e.id === me.id && <span className="ml-1.5 text-xs font-normal text-muted">{t("(siz)")}</span>}
                          </p>
                          {e.email && <p className="truncate text-xs text-muted">{e.email}</p>}
                        </div>
                      </div>
                    </td>
                    <td className={`${td} whitespace-nowrap tabular-nums`}>{formatPhone(e.phone)}</td>
                    <td className={td}>
                      <div className="flex flex-wrap gap-1">
                        {e.roles.map((r) => (
                          <Tag key={r.id}>{r.name}</Tag>
                        ))}
                      </div>
                    </td>
                    <td className={`${td} text-muted`}>{e.branches.length ? e.branches.map((b) => b.name).join(', ') : t("Barcha filiallar")}</td>
                    <td className={`${td} whitespace-nowrap text-muted tabular-nums`}>{e.last_login_at ? formatDateTime(e.last_login_at) : t("Hali kirmagan")}</td>
                    <td className={td}>
                      <StatusPill tone={e.is_active ? 'success' : 'neutral'}>{e.is_active ? t("Faol") : t("Faol emas")}</StatusPill>
                    </td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      {can('employee.update') && <IconButton label={t('{name}ni tahrirlash', { name: e.full_name })} icon={Pencil} onClick={() => setForm(e)} className="inline-grid" />}
                      {can('employee.deactivate') && e.id !== me.id && (
                        <IconButton
                          label={e.is_active ? t("Faolsizlantirish") : t("Faollashtirish")}
                          icon={e.is_active ? UserX : UserCheck}
                          onClick={() => setToggling(e)}
                          className="inline-grid"
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {employees.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={() => void employees.fetchNextPage()} loading={employees.isFetchingNextPage}>
            {t("Yana ko'rsatish")}
          </Button>
        </div>
      )}

      {form && (
        <EmployeeForm employee={form === 'new' ? undefined : form} roles={staffRoles} branches={branches.data ?? []} onClose={() => setForm(null)} />
      )}
      {toggling && (
        <ConfirmDialog
          title={toggling.is_active ? t("Xodimni faolsizlantirish") : t("Xodimni faollashtirish")}
          message={
            toggling.is_active
              ? t("{name} tizimga kira olmay qoladi va ochiq sessiyalari darhol yopiladi. Ma'lumotlari o'chmaydi, keyin qayta faollashtirish mumkin.", { name: toggling.full_name })
              : t('{name} yana tizimga kira oladi.', { name: toggling.full_name })
          }
          confirmLabel={toggling.is_active ? t("Faolsizlantirish") : t("Faollashtirish")}
          danger={toggling.is_active}
          pending={toggle.isPending}
          onConfirm={() => toggle.mutate(toggling)}
          onClose={() => setToggling(null)}
        />
      )}
    </>
  );
}

function EmployeeForm({ employee, roles, branches, onClose }: { employee?: Employee; roles: Ref[]; branches: Ref[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [roleIds, setRoleIds] = useState<string[]>(employee?.roles.map((r) => r.id) ?? []);
  const [branchIds, setBranchIds] = useState<string[]>(employee?.branches.map((b) => b.id) ?? []);
  const [showPassword, setShowPassword] = useState(false);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      employee ? api<Employee>(`/employees/${employee.id}`, { method: 'PATCH', body }) : api<Employee>('/employees', { method: 'POST', body }),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
      toast.success(employee ? t("Xodim ma'lumotlari saqlandi") : t("{name} qo'shildi", { name: saved.full_name }));
      onClose();
    },
  });
  const serverErrors = save.error instanceof ApiError ? save.error.fieldErrors() : {};
  const errors = { ...serverErrors, ...localErrors };
  const duplicate = save.error instanceof ApiError && save.error.code === 'CONFLICT';
  const toggleIn = (list: string[], id: string, on: boolean): string[] => (on ? [...list, id] : list.filter((x) => x !== id));

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = (name: string): string => String(form.get(name) ?? '').trim();
    const local: Record<string, string> = {};
    if (!text('phone') && !text('email')) local.phone = 'Telefon yoki email kiritilishi shart';
    if (roleIds.length === 0) local.role_ids = 'Kamida bitta rol tanlang';
    if (text('password') && text('password').length < 10) local.password = "Parol kamida 10 belgidan iborat bo'lishi kerak";
    setLocalErrors(local);
    if (Object.keys(local).length) return;

    save.mutate({
      full_name: text('full_name'),
      ...(text('phone') ? { phone: text('phone') } : {}),
      ...(text('email') ? { email: text('email') } : {}),
      ...(text('password') ? { password: text('password') } : {}),
      role_ids: roleIds,
      branch_ids: branchIds,
    });
  }

  return (
    <Drawer
      title={employee ? t("Xodimni tahrirlash") : t("Yangi xodim")}
      description={employee ? employee.full_name : t("Xodim shu telefon yoki email va parol bilan tizimga kiradi")}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("Bekor qilish")}
          </Button>
          <Button type="submit" form="employee-form" loading={save.isPending}>
            {t("Saqlash")}
          </Button>
        </>
      }
    >
      <form id="employee-form" onSubmit={onSubmit} className="space-y-6">
        <fieldset className="space-y-4">
          <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{t("Asosiy ma'lumot")}</legend>
          <Field label={t("F.I.O.")} name="full_name" defaultValue={employee?.full_name} placeholder={t("Familiya Ism")} required minLength={2} autoFocus error={errors.full_name} />
          <Field
            label={t("Telefon")}
            name="phone"
            type="tel"
            defaultValue={employee?.phone ?? ''}
            placeholder="+998 90 123-45-67"
            error={errors.phone ?? (duplicate ? t("Bu telefon yoki email bilan xodim allaqachon bor") : undefined)}
          />
          <Field label={t("Email")} name="email" type="email" defaultValue={employee?.email ?? ''} placeholder="ism@example.com" error={errors.email} />
          <Field
            label={employee ? t("Yangi parol") : t("Parol")}
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            required={!employee}
            hint={employee ? t("O'zgartirmaslik uchun bo'sh qoldiring. O'zgarsa, xodimning ochiq sessiyalari yopiladi") : t("Kamida 10 belgi")}
            error={errors.password}
            trailing={
              <IconButton
                label={showPassword ? t("Parolni yashirish") : t("Parolni ko'rsatish")}
                icon={showPassword ? EyeOff : Eye}
                onClick={() => setShowPassword((v) => !v)}
                className="size-8"
              />
            }
          />
        </fieldset>

        <fieldset>
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{t("Rollar")}</legend>
          <p className="mb-3 text-xs text-muted">{t("Rol xodim tizimda nimalarni ko'rishi va qila olishini belgilaydi")}</p>
          <div className="grid gap-2">
            {roles.map((r) => (
              <CheckCard key={r.id} title={r.name} checked={roleIds.includes(r.id)} onChange={(on) => setRoleIds((list) => toggleIn(list, r.id, on))} />
            ))}
          </div>
          {errors.role_ids && <p className="mt-2 text-xs text-danger">{errors.role_ids}</p>}
        </fieldset>

        {branches.length > 0 && (
          <fieldset>
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{t("Filiallar")}</legend>
            <p className="mb-3 text-xs text-muted">
              {branchIds.length === 0 ? t("Hech biri tanlanmasa, xodim barcha filiallarni ko'radi") : t("Xodim faqat tanlangan filiallar ma'lumotini ko'radi")}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {branches.map((b) => (
                <CheckCard key={b.id} title={b.name} checked={branchIds.includes(b.id)} onChange={(on) => setBranchIds((list) => toggleIn(list, b.id, on))} />
              ))}
            </div>
            {errors.branch_ids && <p className="mt-2 text-xs text-danger">{errors.branch_ids}</p>}
          </fieldset>
        )}

        {save.isError && !duplicate && Object.keys(serverErrors).length === 0 && <ErrorNote>{save.error.message}</ErrorNote>}
      </form>
    </Drawer>
  );
}

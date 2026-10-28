'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { GraduationCap, Plus, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { StudentForm } from '@/components/student-form';
import { Avatar, Button, EmptyState, ErrorNote, PageHeader, Panel, SearchInput, Select, StatusPill, TableSkeleton, td, th } from '@/components/ui';
import { api, apiPage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ageOf, formatMoney, formatPhone, studentNo } from '@/lib/format';
import { useNewParam } from '@/lib/use-new-param';
import { STATUS, type Ref, type StudentRow, type StudentStatus } from '@/lib/students';
import { t } from '@/lib/i18n';

export default function StudentsPage() {
  return (
    <Suspense>
      <Students />
    </Suspense>
  );
}

function Students() {
  const { can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // Filtr holati URL'da (TZ P1)
  const filters = { q: params.get('q') ?? '', status: params.get('status') ?? '', branch: params.get('branch') ?? '', owner: params.get('owner') ?? '', group: params.get('group') ?? '', course: params.get('course') ?? '' };
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
  const [creating, setCreating] = useState(false);
  useNewParam(() => can('student.create') && setCreating(true));

  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<Ref[]>('/branches'), enabled: can('branch.view') });
  const units = useQuery({ queryKey: ['study-units', 'list', '', ''], queryFn: () => api<{ id: string; name: string }[]>('/study-units?'), enabled: can('study_unit.view') });
  const courses = useQuery({ queryKey: ['dictionaries', 'discipline'], queryFn: () => api<Ref[]>('/dictionaries?kind=discipline') });
  const owners = useQuery({ queryKey: ['employees', 'options'], queryFn: () => api<{ id: string; full_name: string }[]>('/employees/options') });

  const query = new URLSearchParams({ limit: '30', with_total: 'true' });
  if (filters.q) query.set('q', filters.q);
  if (filters.status) query.set('filter[status]', filters.status);
  if (filters.branch) query.set('filter[branch_id]', filters.branch);
  if (filters.owner) query.set('filter[owner_id]', filters.owner);
  if (filters.group) query.set('filter[study_unit_id]', filters.group);
  if (filters.course) query.set('filter[discipline_id]', filters.course);

  const students = useInfiniteQuery({
    queryKey: ['students', 'list', filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams(query);
      if (pageParam) {
        qs.set('cursor', pageParam);
        qs.delete('with_total');
      }
      return apiPage<StudentRow>(`/students?${qs.toString()}`);
    },
    getNextPageParam: (last) => last.meta.next_cursor,
  });
  const rows = students.data?.pages.flatMap((p) => p.data) ?? [];
  const total = students.data?.pages[0]?.meta.total;
  const filtered = Boolean(filters.q || filters.status || filters.branch || filters.owner || filters.group || filters.course);
  const clearFilters = () => {
    setSearch('');
    router.replace(pathname, { scroll: false });
  };
  const addButton = can('student.create') && (
    <Button onClick={() => setCreating(true)}>
      <Plus className="size-4" aria-hidden /> {t("O'quvchi qo'shish")}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t("O'quvchilar")}
        description={total === undefined ? ' ' : filters.status === 'archived' ? t('Arxivda: {n} ta', { n: total }) : t("Jami: {n} ta o'quvchi", { n: total })}
        action={addButton}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchInput value={search} onChange={setSearch} placeholder="Ism, telefon yoki ID" />
        <Select aria-label={t("Holat")} value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
          <option value="">{t("Barcha holatlar")}</option>
          {(Object.keys(STATUS) as StudentStatus[]).map((s) => (
            <option key={s} value={s}>
              {t(STATUS[s].label)}
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
        {(courses.data?.length ?? 0) > 0 && (
          <Select aria-label={t('Kurs')} value={filters.course} onChange={(e) => setFilter('course', e.target.value)}>
            <option value="">{t('Barcha kurslar')}</option>
            {courses.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        {(units.data?.length ?? 0) > 0 && (
          <Select aria-label={t('Guruh')} value={filters.group} onChange={(e) => setFilter('group', e.target.value)}>
            <option value="">{t('Barcha guruhlar')}</option>
            {units.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        )}
        {(owners.data?.length ?? 0) > 1 && (
          <Select aria-label={t("Mas'ul")} value={filters.owner} onChange={(e) => setFilter('owner', e.target.value)}>
            <option value="">{t("Barcha mas'ullar")}</option>
            {owners.data?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.full_name}
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
        {students.isPending ? (
          <TableSkeleton />
        ) : students.isError ? (
          <div className="p-4">
            <ErrorNote onRetry={() => void students.refetch()}>{students.error.message}</ErrorNote>
          </div>
        ) : rows.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={GraduationCap}
              title={t("Hech narsa topilmadi")}
              hint={t("Qidiruv so'zini yoki filtrlarni o'zgartirib ko'ring.")}
              action={
                <Button variant="secondary" onClick={clearFilters}>
                  {t("Filtrni tozalash")}
                </Button>
              }
            />
          ) : (
            <EmptyState icon={GraduationCap} title={t("Hali o'quvchi yo'q")} hint={t("Birinchi o'quvchini qo'shing — buning uchun ism va filial yetarli.")} action={addButton} />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line bg-canvas/50">
                <tr>
                  <th className={th}>{t("O'quvchi")}</th>
                  <th className={th}>{t("Telefon")}</th>
                  <th className={th}>{t("Filial")}</th>
                  <th className={th}>{t('Guruh va kurs')}</th>
                  <th className={`${th} text-right`}>{t("Balans")}</th>
                  <th className={th}>{t("Holat")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((s) => {
                  const age = ageOf(s.birth_date);
                  return (
                    <tr key={s.id} onClick={() => router.push(`/students/${s.id}`)} className="group cursor-pointer hover:bg-canvas/40">
                      <td className={td}>
                        <div className="flex items-center gap-3">
                          <Avatar name={s.full_name} src={s.photo_url} />
                          <div className="min-w-0">
                            {/* Butun qator bosiladi (tr onClick); havola klaviatura va yangi oynada ochish uchun */}
                            <Link href={`/students/${s.id}`} onClick={(e) => e.stopPropagation()} className="font-medium group-hover:text-brand-strong">
                              {s.full_name}
                            </Link>
                            <p className="flex items-center gap-1.5 text-xs text-muted">
                              <span className="tabular-nums">{studentNo(s.number)}</span>
                              {age !== null && <span>· {age} {t('yosh')}</span>}
                              {s.blacklisted && (
                                <span className="inline-flex items-center gap-1 text-danger">
                                  <ShieldAlert className="size-3.5" aria-hidden /> {t("Qora ro'yxatda")}
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className={`${td} whitespace-nowrap tabular-nums`}>{formatPhone(s.phone)}</td>
                      <td className={`${td} text-muted`}>{s.branch.name}</td>
                      <td className={td}>
                        {s.groups.length === 0 ? (
                          <span className="text-muted">{t('Guruhsiz')}</span>
                        ) : (
                          s.groups.map((g) => (
                            <span key={g.id} className="block leading-snug">
                              <span className="font-medium">{g.name}</span> <span className="text-xs text-muted">{g.course}</span>
                            </span>
                          ))
                        )}
                      </td>
                      <td className={`${td} whitespace-nowrap text-right tabular-nums ${s.balance < 0 ? 'font-medium text-danger' : ''}`}>
                        {s.balance < 0 && <span className="sr-only">Qarz: </span>}
                        {formatMoney(s.balance)}
                      </td>
                      <td className={td}>
                        <StatusPill tone={STATUS[s.status].tone}>{STATUS[s.status].label}</StatusPill>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {students.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={() => void students.fetchNextPage()} loading={students.isFetchingNextPage}>
            {t("Yana ko'rsatish")}
          </Button>
        </div>
      )}
      {creating && <StudentForm onClose={() => setCreating(false)} />}
    </>
  );
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { Building2, ChevronRight, DoorOpen, MapPin, Phone, Plus, Users } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { BranchForm, type Branch } from '@/components/branch-form';
import { Button, EmptyState, ErrorNote, PageHeader, Panel, StatusPill } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatPhone } from '@/lib/format';
import { useNewParam } from '@/lib/use-new-param';
import { t } from '@/lib/i18n';

export default function BranchesPage() {
  return (
    <Suspense>
      <Branches />
    </Suspense>
  );
}

function Branches() {
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  useNewParam(() => can('branch.create') && setCreating(true));
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<Branch[]>('/branches') });
  const addButton = can('branch.create') && (
    <Button onClick={() => setCreating(true)}>
      <Plus className="size-4" aria-hidden /> {t("Filial qo'shish")}
    </Button>
  );

  return (
    <>
      <PageHeader title={t("Filiallar")} description={t("Xonalar, xodimlar va guruhlar filialga bog'lanadi")} action={addButton} />

      {branches.isPending ? (
        <div className="grid gap-4 md:grid-cols-2" role="status" aria-label={t("Yuklanmoqda")}>
          {[0, 1].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl bg-surface" />
          ))}
        </div>
      ) : branches.isError ? (
        <ErrorNote onRetry={() => void branches.refetch()}>{branches.error.message}</ErrorNote>
      ) : branches.data.length === 0 ? (
        <Panel>
          <EmptyState icon={Building2} title={t("Hali filial yo'q")} hint={t("Birinchi filialni qo'shing — keyin unga xona va xodimlarni biriktirasiz.")} action={addButton} />
        </Panel>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {branches.data.map((b) => (
            <li key={b.id}>
              <Link
                href={`/company/branches/${b.id}`}
                className="group block rounded-xl border border-line bg-surface p-5 shadow-card transition-colors hover:border-brand/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold">{b.name}</p>
                    <p className="mt-0.5 text-xs font-medium text-muted">{b.code}</p>
                  </div>
                  <StatusPill tone={b.is_active ? 'success' : 'neutral'}>{b.is_active ? t("Faol") : t("Faol emas")}</StatusPill>
                </div>
                <dl className="mt-4 space-y-1.5 text-sm text-muted">
                  <div className="flex items-center gap-2">
                    <MapPin className="size-4 shrink-0" aria-hidden />
                    <dt className="sr-only">{t("Manzil")}</dt>
                    <dd className="truncate">{b.address ?? t("Manzil kiritilmagan")}</dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone className="size-4 shrink-0" aria-hidden />
                    <dt className="sr-only">{t("Telefon")}</dt>
                    <dd>{b.phone ? formatPhone(b.phone) : t("Telefon kiritilmagan")}</dd>
                  </div>
                </dl>
                <div className="mt-4 flex items-center gap-4 border-t border-line pt-3.5 text-sm">
                  <span className="flex items-center gap-1.5">
                    <DoorOpen className="size-4 text-muted" aria-hidden />
                    <b className="font-semibold">{b.classrooms_count}</b> {t("xona")}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Users className="size-4 text-muted" aria-hidden />
                    <b className="font-semibold">{b.employees_count}</b> {t("xodim")}
                  </span>
                  <ChevronRight className="ml-auto size-4 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-brand" aria-hidden />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {creating && <BranchForm onClose={() => setCreating(false)} />}
    </>
  );
}

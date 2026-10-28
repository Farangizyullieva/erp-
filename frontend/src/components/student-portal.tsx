'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Dices, KeyRound, ShieldOff } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '@/components/toast';
import { Button, ErrorNote, Field, Modal, StatusPill } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDateTime, formatPhone } from '@/lib/format';
import { t } from '@/lib/i18n';

interface PortalStatus {
  enabled: boolean;
  login: string | null;
  last_login_at: string | null;
}

/** O'quvchi kabinetini yoqish/o'chirish. Parol faqat bir marta — yaratilgan paytda ko'rsatiladi */
export function StudentPortalDialog({ studentId, name, onClose }: { studentId: string; name: string; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [creds, setCreds] = useState<{ login: string; password: string } | null>(null);
  // Admin parolni o'zi yozadi; xohlasa tasodifiy 6 xonali raqam yaratadi
  const [password, setPassword] = useState('');
  const status = useQuery({ queryKey: ['students', studentId, 'portal'], queryFn: () => api<PortalStatus>(`/students/${studentId}/portal`) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['students', studentId, 'portal'] });
  const enable = useMutation({
    mutationFn: () => api<{ login: string; password: string }>(`/students/${studentId}/portal`, { method: 'POST', body: { password } }),
    onSuccess: async (r) => {
      setCreds(r);
      setPassword('');
      await refresh();
    },
  });
  const disable = useMutation({
    mutationFn: () => api<unknown>(`/students/${studentId}/portal`, { method: 'DELETE' }),
    onSuccess: async () => {
      setCreds(null);
      await refresh();
      toast.success("Kabinet o'chirildi");
    },
  });
  const copy = async () => {
    if (!creds) return;
    try {
      await navigator.clipboard.writeText(`${t('Sayt')}: ${window.location.origin}/student/login\n${t('Login')}: ${creds.login}\n${t('Parol')}: ${creds.password}`);
      toast.success('Nusxa olindi');
    } catch {
      toast.error("Nusxa olib bo'lmadi — qo'lda yozib oling");
    }
  };
  const s = status.data;
  const error = enable.error ?? disable.error;

  return (
    <Modal title="O'quvchi kabineti" description={name} onClose={onClose}>
      {status.isPending ? (
        <div className="h-32 animate-pulse rounded-lg bg-canvas" role="status" />
      ) : status.isError ? (
        <ErrorNote onRetry={() => void status.refetch()}>{status.error.message}</ErrorNote>
      ) : (
        s && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm leading-relaxed text-muted">{t("O'quvchi o'z telefon raqami va parol bilan kirib, jadvali, davomati, balansi va to'lovlarini ko'radi. Hech narsani o'zgartira olmaydi.")}</p>
              <span className="shrink-0">
                <StatusPill tone={s.enabled ? 'success' : 'neutral'}>{s.enabled ? 'Yoqilgan' : "O'chiq"}</StatusPill>
              </span>
            </div>

            {creds ? (
              <div className="rounded-xl border border-brand bg-brand-soft/50 p-4">
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">{t('Login')}</dt>
                    <dd className="font-medium tabular-nums">{formatPhone(creds.login)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">{t('Parol')}</dt>
                    <dd className="font-mono text-xl font-semibold tracking-[0.2em]">{creds.password}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-sm">
                  <span className="text-muted">{t('Kirish manzili')}: </span>
                  <span className="font-medium">{typeof window === 'undefined' ? '' : window.location.host}/student/login</span>
                </p>
                <p className="mt-3 text-xs leading-relaxed text-muted">{t("Parol faqat hozir ko'rsatiladi — o'quvchiga yozib bering yoki nusxasini yuboring. Unutilsa, shu yerda yangisini qo'yasiz.")}</p>
                <Button variant="secondary" size="sm" onClick={() => void copy()} className="mt-3">
                  <Copy className="size-4" aria-hidden /> Nusxa olish
                </Button>
              </div>
            ) : (
              s.enabled && (
                <dl className="space-y-2 rounded-lg border border-line px-3.5 py-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">{t('Login')}</dt>
                    <dd className="font-medium tabular-nums">{formatPhone(s.login)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">{t('Oxirgi kirish')}</dt>
                    <dd className="tabular-nums">{s.last_login_at ? formatDateTime(s.last_login_at) : t('Hali kirmagan')}</dd>
                  </div>
                </dl>
              )
            )}

            {!creds && (
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Field
                    label={s.enabled ? 'Yangi parol' : 'Parol'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={6}
                    maxLength={100}
                    autoComplete="off"
                    placeholder="Kamida 6 ta belgi"
                    hint="O'quvchi shu parol bilan kiradi"
                  />
                </div>
                <Button variant="secondary" onClick={() => setPassword(String(100000 + Math.floor(Math.random() * 900000)))} className="mb-6 shrink-0">
                  <Dices className="size-4" aria-hidden /> Tasodifiy
                </Button>
              </div>
            )}
            {error && <ErrorNote>{error.message}</ErrorNote>}
            <div className="flex flex-wrap justify-end gap-2">
              {s.enabled && (
                <Button variant="secondary" onClick={() => disable.mutate()} loading={disable.isPending} className="mr-auto !text-danger">
                  <ShieldOff className="size-4" aria-hidden /> Kabinetni o'chirish
                </Button>
              )}
              <Button onClick={() => enable.mutate()} loading={enable.isPending} disabled={!creds && password.trim().length < 6}>
                <KeyRound className="size-4" aria-hidden /> {s.enabled ? 'Parolni saqlash' : 'Kabinetni yoqish'}
              </Button>
            </div>
          </div>
        )
      )}
    </Modal>
  );
}

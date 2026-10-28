'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, ShieldAlert, ShieldCheck } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState, type FormEvent } from 'react';
import { useToast } from '@/components/toast';
import { Button, ErrorNote, Field, Modal, PageHeader, Panel, StatusPill, TableSkeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';

interface Status {
  enabled: boolean;
  recommended: boolean;
}

const fieldErrors = (e: unknown): Record<string, string> => (e instanceof ApiError ? e.fieldErrors() : {});
const digits = (form: FormData): string => String(form.get('code') ?? '').replace(/\D/g, '');

// Akkaunt xavfsizligi: ikki bosqichli tasdiqlash (TOTP). Parol o'g'irlansa ham, telefondagi kodsiz kirib bo'lmaydi.
export default function SecurityPage() {
  const status = useQuery({ queryKey: ['auth', '2fa'], queryFn: () => api<Status>('/auth/2fa') });
  const [dialog, setDialog] = useState<'enable' | 'disable' | null>(null);

  return (
    <>
      <PageHeader title="Xavfsizlik" description="Akkauntingizni himoyalash sozlamalari" />
      <div className="max-w-2xl">
        {status.isPending ? (
          <Panel>
            <TableSkeleton rows={2} />
          </Panel>
        ) : status.isError ? (
          <ErrorNote onRetry={() => void status.refetch()}>{status.error.message}</ErrorNote>
        ) : (
          <Panel className="p-5">
            <div className="flex items-start gap-4">
              <span className={status.data.enabled ? 'grid size-11 shrink-0 place-items-center rounded-xl bg-success-soft text-success' : 'grid size-11 shrink-0 place-items-center rounded-xl bg-warning-soft text-warning'}>
                {status.data.enabled ? <ShieldCheck className="size-6" aria-hidden /> : <ShieldAlert className="size-6" aria-hidden />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">{t('Ikki bosqichli tasdiqlash')}</h2>
                  <StatusPill tone={status.data.enabled ? 'success' : 'neutral'}>{status.data.enabled ? 'Yoqilgan' : "O'chirilgan"}</StatusPill>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">
                  {t("Kirishda paroldan tashqari telefoningizdagi autentifikator ilovasi (Google Authenticator, Microsoft Authenticator va h.k.) ko'rsatgan 6 xonali kod so'raladi. Parolingiz boshqalarga ma'lum bo'lib qolsa ham, akkauntga kira olishmaydi.")}
                </p>
                {!status.data.enabled && status.data.recommended && (
                  <p className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning">{t("Sizning rolingiz moliya va sozlamalarga kira oladi — ikki bosqichli tasdiqlashni yoqish qat'iy tavsiya etiladi.")}</p>
                )}
                <div className="mt-4">
                  {status.data.enabled ? (
                    <Button variant="secondary" onClick={() => setDialog('disable')}>
                      O'chirish
                    </Button>
                  ) : (
                    <Button onClick={() => setDialog('enable')}>Yoqish</Button>
                  )}
                </div>
              </div>
            </div>
          </Panel>
        )}
      </div>
      {dialog === 'enable' && <EnableDialog onClose={() => setDialog(null)} />}
      {dialog === 'disable' && <DisableDialog onClose={() => setDialog(null)} />}
    </>
  );
}

function EnableDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [qr, setQr] = useState<string | null>(null);
  const setup = useMutation({ mutationFn: (password: string) => api<{ secret: string; otpauth_url: string }>('/auth/2fa/setup', { method: 'POST', body: { password } }) });
  const enable = useMutation({
    mutationFn: (code: string) => api<Status>('/auth/2fa/enable', { method: 'POST', body: { code } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth', '2fa'] });
      toast.success('Ikki bosqichli tasdiqlash yoqildi');
      onClose();
    },
  });
  const secret = setup.data?.secret;
  const url = setup.data?.otpauth_url;

  // QR kod brauzerning o'zida chiziladi — maxfiy kalit hech qanday tashqi xizmatga yuborilmaydi
  useEffect(() => {
    if (url) void QRCode.toDataURL(url, { margin: 1, width: 200 }).then(setQr);
  }, [url]);

  if (!secret) {
    const errors = fieldErrors(setup.error);
    const onSubmit = (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setup.mutate(String(new FormData(e.currentTarget).get('password') ?? ''));
    };
    return (
      <Modal title="Ikki bosqichli tasdiqlashni yoqish" description="Davom etish uchun parolingizni tasdiqlang" onClose={onClose}>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Parol" name="password" type="password" autoComplete="current-password" required autoFocus error={errors.password} />
          {setup.isError && !errors.password && <ErrorNote>{setup.error.message}</ErrorNote>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Bekor qilish
            </Button>
            <Button type="submit" loading={setup.isPending}>
              Davom etish
            </Button>
          </div>
        </form>
      </Modal>
    );
  }

  const errors = fieldErrors(enable.error);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    enable.mutate(digits(new FormData(e.currentTarget)));
  };
  return (
    <Modal title="Autentifikator ilovasini ulash" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <ol className="space-y-3 text-sm">
          <li>
            <b className="font-semibold">1.</b> {t('Autentifikator ilovasida QR kodni skanerlang:')}
          </li>
        </ol>
        <div className="grid place-items-center rounded-xl border border-line bg-white p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- data: URL, tarmoqdan yuklanmaydi */}
          {qr ? <img src={qr} alt={t('Ulash uchun QR kod')} width={200} height={200} /> : <div className="size-[200px] animate-pulse rounded-lg bg-canvas" />}
        </div>
        <div>
          <p className="text-[13px] text-muted">{t("Skanerlab bo'lmasa, kalitni qo'lda kiriting:")}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-canvas px-3 py-2 font-mono text-[13px] tracking-wider">{secret.replace(/(.{4})/g, '$1 ').trim()}</code>
            <Button variant="secondary" size="sm" onClick={() => void navigator.clipboard.writeText(secret).then(() => toast.success('Kalit nusxalandi'))}>
              <Copy className="size-4" aria-hidden /> Nusxalash
            </Button>
          </div>
        </div>
        <p className="text-sm">
          <b className="font-semibold">2.</b> {t("Ilova ko'rsatgan 6 xonali kodni kiriting:")}
        </p>
        <Field label="Kod" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="000000" required autoFocus error={errors.code} className="text-center text-lg tracking-[0.4em] tabular-nums" />
        {enable.isError && !errors.code && <ErrorNote>{enable.error.message}</ErrorNote>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button type="submit" loading={enable.isPending}>
            Yoqish
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DisableDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const disable = useMutation({
    mutationFn: (body: { password: string; code: string }) => api<Status>('/auth/2fa/disable', { method: 'POST', body }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth', '2fa'] });
      toast.success("Ikki bosqichli tasdiqlash o'chirildi");
      onClose();
    },
  });
  const errors = fieldErrors(disable.error);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    disable.mutate({ password: String(form.get('password') ?? ''), code: digits(form) });
  };
  return (
    <Modal title="Ikki bosqichli tasdiqlashni o'chirish" description="Bu akkauntingiz himoyasini susaytiradi. Tasdiqlash uchun parol va joriy kodni kiriting." onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Parol" name="password" type="password" autoComplete="current-password" required autoFocus error={errors.password} />
        <Field label="Kod" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="000000" required error={errors.code} />
        {disable.isError && Object.keys(errors).length === 0 && <ErrorNote>{disable.error.message}</ErrorNote>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button type="submit" variant="danger" loading={disable.isPending}>
            O'chirish
          </Button>
        </div>
      </form>
    </Modal>
  );
}

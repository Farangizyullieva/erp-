'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, FileText } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState, type FormEvent } from 'react';
import { useToast } from '@/components/toast';
import { Button, ErrorNote, Modal } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { t } from '@/lib/i18n';

/** Aloqa shaxsini botga ulash: bir martalik havola + QR (ota-ona telefonida skanerlaydi yoki havola unga yuboriladi) */
export function TelegramLinkDialog({ studentId, contact, onClose }: { studentId: string; contact: { id: string; full_name: string }; onClose: () => void }) {
  const toast = useToast();
  const [qr, setQr] = useState<string | null>(null);
  const link = useQuery({
    queryKey: ['telegram-link', contact.id],
    queryFn: () => api<{ url: string; expires_at: string }>(`/students/${studentId}/contacts/${contact.id}/telegram-link`, { method: 'POST' }),
    // Har ochilganda yangi bir martalik havola; qayta so'ralmasin
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  const url = link.data?.url;
  useEffect(() => {
    if (url) void QRCode.toDataURL(url, { margin: 1, width: 200 }).then(setQr);
  }, [url]);

  return (
    <Modal title="Telegram'ga ulash" description={contact.full_name} onClose={onClose}>
      {link.isPending ? (
        <div className="mx-auto size-[200px] animate-pulse rounded-lg bg-canvas" role="status" />
      ) : link.isError ? (
        <ErrorNote>{link.error.message}</ErrorNote>
      ) : (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-muted">{t("Ota-ona shu QR kodni telefonida skanerlasin yoki havolani unga yuboring. Botda «Start» bosilgach ulanadi.")}</p>
          <div className="grid place-items-center rounded-xl border border-line bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- data: URL, tarmoqdan yuklanmaydi */}
            {qr ? <img src={qr} alt={t('Ulash uchun QR kod')} width={200} height={200} /> : <div className="size-[200px] animate-pulse rounded-lg bg-canvas" />}
          </div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-canvas px-3 py-2 font-mono text-xs">{link.data.url}</code>
            <Button variant="secondary" size="sm" onClick={() => void navigator.clipboard.writeText(link.data.url).then(() => toast.success('Havola nusxalandi'))}>
              <Copy className="size-4" aria-hidden /> Nusxalash
            </Button>
          </div>
          <p className="text-xs text-muted">{t('Havola bir martalik va {date} gacha amal qiladi.', { date: formatDate(link.data.expires_at) })}</p>
        </div>
      )}
    </Modal>
  );
}

/** O'quvchining Telegram'ga ulangan aloqa shaxslariga xabar. Xabar navbatga tushadi va bir necha soniyada yuboriladi. */
export function SendMessageDialog({ studentId, studentName, onClose }: { studentId: string; studentName: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const send = useMutation({
    mutationFn: () => api<{ queued: number }>(`/students/${studentId}/messages`, { method: 'POST', body: { text } }),
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: ['messaging'] });
      toast.success(t('Xabar navbatga qo\'yildi ({n} ta oluvchi)', { n: r.queued }));
      onClose();
    },
  });
  const preview = useMutation({
    mutationFn: () => api<{ text: string }>(`/students/${studentId}/weekly-report`),
    onSuccess: (r) => setText(r.text),
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) send.mutate();
  };

  return (
    <Modal title="Telegram orqali xabar" description={t('{name} — ulangan aloqa shaxslariga', { name: studentName })} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3.5">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          maxLength={2000}
          required
          autoFocus
          placeholder={t('Xabar matni…')}
          aria-label={t('Xabar matni')}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/15"
        />
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" loading={preview.isPending} onClick={() => preview.mutate()}>
            <FileText className="size-4" aria-hidden /> Haftalik hisobot matni
          </Button>
          <span className="text-xs tabular-nums text-muted">{text.length}/2000</span>
        </div>
        {(send.isError || preview.isError) && <ErrorNote>{(send.error ?? preview.error)?.message}</ErrorNote>}
        <p className="text-xs leading-relaxed text-muted">{t('Xabar faqat 09:00–21:00 oralig\'ida yetkaziladi; tunda yozilgani ertalab ketadi.')}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button type="submit" loading={send.isPending} disabled={!text.trim()}>
            Yuborish
          </Button>
        </div>
      </form>
    </Modal>
  );
}

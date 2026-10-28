'use client';

import clsx from 'clsx';
import { Camera, LoaderCircle } from 'lucide-react';
import { useRef, useState } from 'react';
import { useToast } from '@/components/toast';
import { Avatar } from '@/components/ui';
import { apiUpload } from '@/lib/api';
import { t } from '@/lib/i18n';

const MAX_BYTES = 3 * 1024 * 1024;

/** Bosiladigan avatar: rasm tanlanadi va yuklanadi. Turi va hajmi serverda ham tekshiriladi (mazmun bo'yicha). */
export function PhotoUpload({ name, src, uploadPath, onUploaded, size = 'xl' }: { name: string; src: string | null; uploadPath: string; onUploaded: (url: string) => void | Promise<unknown>; size?: 'lg' | 'xl' }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onPick(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast.error('Rasm hajmi 3 MB dan oshmasligi kerak');
      return;
    }
    setBusy(true);
    try {
      const { photo_url } = await apiUpload<{ photo_url: string }>(uploadPath, file);
      await onUploaded(photo_url);
      toast.success('Rasm saqlandi');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rasm yuklanmadi');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <>
      <button type="button" onClick={() => input.current?.click()} disabled={busy} aria-label={t("Rasmni o'zgartirish")} title={t("Rasmni o'zgartirish")} className="group relative rounded-full">
        <Avatar name={name} src={src} size={size} />
        <span className={clsx('absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white transition-opacity', busy ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100')}>
          {busy ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : <Camera className="size-5" aria-hidden />}
        </span>
      </button>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void onPick(e.target.files?.[0])} />
    </>
  );
}

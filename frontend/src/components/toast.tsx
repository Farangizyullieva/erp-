'use client';

import clsx from 'clsx';
import { CircleAlert, CircleCheck, X } from 'lucide-react';
import { t } from '@/lib/i18n';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface Toast {
  id: number;
  tone: 'success' | 'error';
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
let seq = 0;

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((item) => item.id !== id)), []);
  const push = useCallback(
    (tone: Toast['tone'], message: string) => {
      const id = ++seq;
      setToasts((list) => [...list.slice(-3), { id, tone, message: t(message) }]);
      setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 4000);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(
    () => ({ success: (m) => push('success', m), error: (m) => push('error', m) }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(92vw,22rem)] flex-col gap-2" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className={clsx(
              'pointer-events-auto flex animate-in items-start gap-2.5 rounded-xl border bg-surface p-3 text-sm shadow-pop',
              toast.tone === 'error' ? 'border-danger/30' : 'border-line',
            )}
          >
            {toast.tone === 'error' ? (
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
            ) : (
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            )}
            <p className="flex-1 leading-snug">{toast.message}</p>
            <button type="button" onClick={() => dismiss(toast.id)} aria-label={t("Yopish")} className="rounded p-0.5 text-muted hover:text-ink">
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

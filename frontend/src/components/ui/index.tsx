'use client';

import clsx from 'clsx';
import { ArrowLeft, Check, ChevronRight, LoaderCircle, Search, X, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Children,
  useEffect,
  useState,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { initials } from '@/lib/format';
import { t } from '@/lib/i18n';
import { HOME, NAV_ITEMS } from '@/lib/nav';

/** Matnli bolalarni tarjima qiladi (bo'shliqlar saqlanadi); element va ifodalar o'zgarishsiz qoladi */
function tr(node: ReactNode): ReactNode {
  if (typeof node === 'string') {
    const text = node.trim();
    return text ? node.replace(text, t(text)) : node;
  }
  return Array.isArray(node) ? Children.map(node as ReactNode[], tr) : node;
}
const ts = (text: string | undefined): string | undefined => (text === undefined ? undefined : t(text));

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  // hover — yorqinlik bilan: to'q rejimda brand-strong och rang bo'lgani uchun fon sifatida ishlatilmaydi
  primary: 'bg-brand text-white shadow-card hover:brightness-110',
  secondary: 'border border-line bg-surface text-ink hover:bg-canvas',
  ghost: 'text-ink hover:bg-canvas',
  danger: 'bg-danger text-white shadow-card hover:opacity-90',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-55',
        size === 'sm' && 'h-8 px-2.5 text-[13px]',
        size === 'md' && 'h-9.5 px-3.5 text-sm',
        size === 'lg' && 'h-11 px-5 text-[15px]',
        VARIANTS[variant],
        className,
      )}
    >
      {loading && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      {tr(children)}
    </button>
  );
}

export function IconButton({
  label,
  icon: Icon,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: LucideIcon }) {
  return (
    <button
      type="button"
      {...props}
      aria-label={t(label)}
      title={t(label)}
      className={clsx('grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-canvas hover:text-ink', className)}
    >
      <Icon className="size-[18px]" aria-hidden />
    </button>
  );
}

const control =
  'rounded-lg border bg-surface px-3 text-sm transition-shadow placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/15';

function FieldShell({
  id,
  label,
  required,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium text-ink">
        {t(label)}
        {required && (
          <span className="text-danger" aria-hidden>
            {' '}
            *
          </span>
        )}
      </label>
      {children}
      {(error || hint) && (
        <p id={`${id}-msg`} className={clsx('text-xs leading-snug', error ? 'text-danger' : 'text-muted')}>
          {error ?? ts(hint)}
        </p>
      )}
    </div>
  );
}

interface FieldExtras {
  label: string;
  error?: string;
  hint?: string;
  trailing?: ReactNode;
}

export function Field({ label, error, hint, trailing, className, ...props }: InputHTMLAttributes<HTMLInputElement> & FieldExtras) {
  const auto = useId();
  const id = props.id ?? auto;
  return (
    <FieldShell id={id} label={label} required={props.required} error={error} hint={hint}>
      <div className="relative">
        <input
          {...props}
          placeholder={ts(props.placeholder)}
          id={id}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error || hint ? `${id}-msg` : undefined}
          className={clsx(control, 'h-10 w-full', trailing && 'pr-10', error ? 'border-danger' : 'border-line', className)}
        />
        {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
      </div>
    </FieldShell>
  );
}

export function SelectField({
  label,
  error,
  hint,
  children,
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & Omit<FieldExtras, 'trailing'>) {
  const auto = useId();
  const id = props.id ?? auto;
  return (
    <FieldShell id={id} label={label} required={props.required} error={error} hint={hint}>
      <select {...props} id={id} className={clsx(control, 'h-10 w-full', error ? 'border-danger' : 'border-line', className)}>
        {children}
      </select>
    </FieldShell>
  );
}

export function TextareaField({
  label,
  error,
  hint,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & Omit<FieldExtras, 'trailing'>) {
  const auto = useId();
  const id = props.id ?? auto;
  return (
    <FieldShell id={id} label={label} required={props.required} error={error} hint={hint}>
      <textarea {...props} placeholder={ts(props.placeholder)} id={id} rows={props.rows ?? 3} className={clsx(control, 'w-full py-2', error ? 'border-danger' : 'border-line', className)} />
    </FieldShell>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          onClick={() => onChange(tab.id)}
          className={clsx(
            '-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-sm transition-colors',
            tab.id === value ? 'border-brand font-medium text-brand-strong' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {t(tab.label)}
          {tab.count !== undefined && <span className="rounded-full bg-canvas px-1.5 text-xs text-muted">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={clsx(control, 'h-9.5 max-w-full border-line', className)} />;
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative w-full sm:max-w-xs">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t(placeholder)}
        aria-label={t(placeholder)}
        className={clsx(control, 'h-9.5 w-full border-line pl-9')}
      />
    </div>
  );
}

/** Katta bosiladigan maydonli checkbox kartochka — rol va filial tanlash uchun */
export function CheckCard({
  checked,
  onChange,
  title,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={clsx(
        'flex items-start gap-3 rounded-lg border p-3 transition-colors',
        checked ? 'border-brand bg-brand-soft/60' : 'border-line hover:bg-canvas',
        disabled && 'cursor-not-allowed opacity-55',
      )}
    >
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden
        className={clsx(
          'mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-[5px] border peer-focus-visible:ring-3 peer-focus-visible:ring-brand/30',
          checked ? 'border-brand bg-brand text-white' : 'border-muted/50 bg-surface',
        )}
      >
        {checked && <Check className="size-3.5" strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium leading-snug">{t(title)}</span>
        {description && <span className="block text-xs leading-snug text-muted">{t(description)}</span>}
      </span>
    </label>
  );
}

type Tone = 'success' | 'neutral' | 'danger' | 'warning' | 'info';
const TONES: Record<Tone, string> = {
  success: 'bg-success-soft text-success',
  neutral: 'bg-canvas text-muted',
  danger: 'bg-danger-soft text-danger',
  warning: 'bg-warning-soft text-warning',
  info: 'bg-info-soft text-info',
};

/** Status faqat rang bilan emas, matn bilan ham ajratiladi (TZ 11.6) */
export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium', TONES[tone])}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {tr(children)}
    </span>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="inline-flex whitespace-nowrap rounded-md bg-canvas px-2 py-0.5 text-xs font-medium text-ink/80">{tr(children)}</span>;
}

const AVATAR_TONES = ['bg-brand-soft text-brand-strong', 'bg-info-soft text-info', 'bg-warning-soft text-warning', 'bg-success-soft text-success'];

export function Avatar({ name, src, size = 'md' }: { name: string; src?: string | null; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const [failed, setFailed] = useState(false);
  const box = clsx('shrink-0 rounded-full', size === 'sm' && 'size-8 text-xs', size === 'md' && 'size-9 text-[13px]', size === 'lg' && 'size-12 text-base', size === 'xl' && 'size-20 text-2xl');
  if (src && !failed) {
    // Rasm backend'dan imzolangan havola orqali keladi; yuklanmasa bosh harflarga qaytadi
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className={clsx(box, 'bg-canvas object-cover')} />;
  }
  const tone = AVATAR_TONES[[...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % AVATAR_TONES.length];
  return (
    <span aria-hidden className={clsx(box, 'grid place-items-center font-semibold', tone)}>
      {initials(name)}
    </span>
  );
}

/** Raqamni 0 dan qiymatgacha yumshoq "sanab" ko'rsatadi; harakatni kamaytirish yoqilgan bo'lsa — darhol */
export function CountUp({ value, format = (n: number) => String(n) }: { value: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 600);
      const eased = 1 - (1 - progress) ** 3;
      setShown(Math.round(origin + (value - origin) * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{format(shown)}</>;
}

export function PageHeader({ title, description, action, back }: { title: string; description?: string; action?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-5">
      <div className="mb-3 flex min-h-5 items-center justify-between gap-3">
        <div>{back ?? <BackButton />}</div>
        <Breadcrumbs current={title} />
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight">{t(title)}</h1>
          {description && <p className="mt-1 text-sm text-muted">{t(description)}</p>}
        </div>
        {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
      </div>
    </div>
  );
}

/** Oldingi sahifaga qaytaradi; tarix bo'sh bo'lsa (havola yangi oynada ochilgan) — ish stoliga */
export function BackButton({ label = 'Orqaga' }: { label?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  if (pathname === HOME) return null;
  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? router.back() : router.push(HOME))}
      className="inline-flex items-center gap-1.5 rounded-lg py-1 pr-2 text-sm text-muted hover:text-ink"
    >
      <ArrowLeft className="size-4" aria-hidden /> {t(label)}
    </button>
  );
}

/** Bosh sahifa › Bo'lim › Joriy sahifa — bo'lim nomi navigatsiyadan olinadi */
export function Breadcrumbs({ current }: { current: string }) {
  const pathname = usePathname();
  if (pathname === HOME) return null;
  const section = NAV_ITEMS.find((item) => item.href !== HOME && (pathname === item.href || pathname.startsWith(`${item.href}/`)));
  const page = section?.pages?.find((p) => pathname === p.href || pathname.startsWith(`${p.href}/`));
  const trail = [section && { label: section.label, href: section.pages?.[0]?.href ?? section.href }, page && { label: page.label, href: page.href }]
    .filter((c): c is { label: string; href: string } => Boolean(c))
    .filter((c) => c.label !== current);
  return (
    <nav aria-label={t("Yo'l")} className="hidden items-center gap-1.5 text-[13px] text-muted sm:flex">
      <Link href={HOME} className="hover:text-ink">
        {t('Bosh sahifa')}
      </Link>
      {trail.map((c) => (
        <span key={c.label} className="flex items-center gap-1.5">
          <ChevronRight className="size-3.5" aria-hidden />
          <Link href={c.href} className="hover:text-ink">
            {t(c.label)}
          </Link>
        </span>
      ))}
      <ChevronRight className="size-3.5" aria-hidden />
      <span className="max-w-48 truncate font-medium text-ink" aria-current="page">
        {t(current)}
      </span>
    </nav>
  );
}

/** Bir nechta variantdan birini tanlash (ko'rinish, davr va h.k.) */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: { id: T; label: string }[]; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div role="group" aria-label={t(label)} className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={o.id === value}
          onClick={() => onChange(o.id)}
          className={clsx('h-8 rounded-md px-3 text-[13px] font-medium transition-colors', o.id === value ? 'bg-brand text-white' : 'text-muted hover:text-ink')}
        >
          {t(o.label)}
        </button>
      ))}
    </div>
  );
}

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={clsx('rounded-xl border border-line bg-surface shadow-card', className)}>{children}</section>;
}

export function EmptyState({ icon: Icon, title, hint, action }: { icon?: LucideIcon; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-6 py-12 text-center">
      {Icon && (
        // Bezak: ikonka atrofida yumshoq halqalar va suzib yuruvchi nuqtalar (faqat CSS, rasm fayli yo'q)
        <span className="relative mb-3 grid size-24 place-items-center" aria-hidden>
          <span className="absolute inset-0 rounded-full bg-brand-soft/50" />
          <span className="absolute inset-3 rounded-full bg-brand-soft" />
          <span className="absolute -right-1 top-3 size-2.5 animate-float rounded-full bg-brand/40" />
          <span className="absolute bottom-2 left-0 size-2 animate-float rounded-full bg-warning/50 [animation-delay:-2s]" />
          <span className="absolute -top-1 left-6 size-1.5 animate-float rounded-full bg-success/50 [animation-delay:-4s]" />
          <span className="relative grid size-12 place-items-center rounded-2xl bg-surface text-brand shadow-card">
            <Icon className="size-6" />
          </span>
        </span>
      )}
      <p className="font-medium">{t(title)}</p>
      {hint && <p className="max-w-sm text-sm text-muted">{t(hint)}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorNote({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
      <span>{tr(children)}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="shrink-0 font-medium underline underline-offset-2">
          {t('Qayta urinish')}
        </button>
      )}
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2.5 p-4" role="status" aria-label={t("Yuklanmoqda")}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-lg bg-canvas" />
      ))}
    </div>
  );
}

// Native <dialog>: fokus tuzog'i, Escape va fon bloklanishi brauzerdan keladi
function useModalDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return ref;
}

interface OverlayProps {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

function OverlayHeader({ title, description, onClose }: Omit<OverlayProps, 'children' | 'footer'>) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div>
        <h2 className="text-base font-semibold leading-tight">{t(title)}</h2>
        {description && <p className="mt-1 text-[13px] text-muted">{t(description)}</p>}
      </div>
      <IconButton label={t("Yopish")} icon={X} onClick={onClose} className="-mr-2 -mt-1.5" />
    </header>
  );
}

export function Modal({ title, description, onClose, children, footer, wide }: OverlayProps & { wide?: boolean }) {
  const ref = useModalDialog();
  return (
    <dialog
      ref={ref}
      aria-label={t(title)}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      className={clsx('m-auto animate-in rounded-2xl bg-surface p-0 text-ink shadow-pop', wide ? 'w-[min(94vw,40rem)]' : 'w-[min(92vw,28rem)]')}
    >
      <OverlayHeader title={title} description={description} onClose={onClose} />
      <div className="px-5 py-4">{children}</div>
      {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</footer>}
    </dialog>
  );
}

/** Uzun formalar uchun o'ng tomondan chiqadigan panel */
export function Drawer({ title, description, onClose, children, footer }: OverlayProps) {
  const ref = useModalDialog();
  return (
    <dialog
      ref={ref}
      aria-label={t(title)}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      className="my-0 ml-auto mr-0 h-dvh max-h-none w-[min(100vw,30rem)] max-w-none animate-slide bg-surface p-0 text-ink shadow-pop"
    >
      <div className="flex h-full flex-col">
        <OverlayHeader title={title} description={description} onClose={onClose} />
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</footer>}
      </div>
    </dialog>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  pending,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("Bekor qilish")}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-muted">{t(message)}</p>
    </Modal>
  );
}

export const th = 'whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-muted';
export const td = 'px-4 py-3 text-sm align-middle';

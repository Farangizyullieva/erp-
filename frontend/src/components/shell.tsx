'use client';

import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Building2, Check, ChevronDown, ChevronsLeft, ChevronsRight, Camera, GraduationCap, LogOut, Menu, MessagesSquare, Moon, Search, ShieldCheck, Sun, Zap } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CommandPalette } from '@/components/command-palette';
import { NotificationBell } from '@/components/notifications';
import { Avatar, ConfirmDialog, IconButton } from '@/components/ui';
import { api, apiUpload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { t, useLang, type Lang } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { HOME, NAV, QUICK_ACTIONS, type NavPage, type NavSection } from '@/lib/nav';

const COLLAPSED_KEY = 'educrm.sidebar.collapsed';
const LANGS: { id: Lang; label: string }[] = [
  { id: 'uz', label: "O'zbekcha" },
  { id: 'ru', label: 'Ruscha' },
];
const isActive = (pathname: string, href: string): boolean => pathname === href || pathname.startsWith(`${href}/`);

/** Tashqariga bosilganda yoki Escape'da yopiladigan menyu */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', handler);
    };
  }, [open, close]);
  return ref;
}

const menu = 'absolute right-0 top-full z-10 mt-1.5 animate-in rounded-xl border border-line bg-surface p-1.5 shadow-pop';
const menuItem = 'flex h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm hover:bg-canvas';

// App shell (TZ 4.3): to'q rangli sidebar + oq topbar (qidiruv, tezkor amallar, chat, bildirishnoma, til, profil)
export function Shell({ children }: { children: ReactNode }) {
  const { me, can, logout, reload } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const photoInput = useRef<HTMLInputElement>(null);
  const { lang, setLang } = useLang();
  const pathname = usePathname();
  // Topbar belgilari: o'qilmagan bildirishnoma va xabarlar soni
  const counters = useQuery({
    queryKey: ['inbox', 'counters'],
    queryFn: () => api<{ notifications: number; messages: number }>('/inbox/counters'),
    refetchInterval: 20_000,
  });
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [open, setOpen] = useState<'profile' | 'actions' | 'lang' | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  // Qo'lda ochilgan/yopilgan bo'limlar; belgilanmaganlari faol sahifaga qarab ochiladi
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const menusRef = useDismiss(open !== null, () => setOpen(null));
  const toggle = (name: NonNullable<typeof open>) => setOpen((current) => (current === name ? null : name));

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === '1');
    } catch {
      /* storage mavjud emas */
    }
  }, []);
  useEffect(() => setMobileOpen(false), [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleCollapsed = () =>
    setCollapsed((prev) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, prev ? '0' : '1');
      } catch {
        /* storage mavjud emas */
      }
      return !prev;
    });

  const visible = (page: NavPage): boolean => !page.permissions?.length || can(...page.permissions);
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter(visible) })).filter((g) => g.items.length > 0);
  const actions = QUICK_ACTIONS.filter((a) => can(a.permission));
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  const roles = me.role_names.map((name) => t(name)).join(', ');
  const messages = counters.data?.messages ?? 0;

  const renderItem = (section: NavSection) => {
    const active = isActive(pathname, section.href);
    const pages = (section.pages ?? []).filter(visible);
    const Icon = section.icon;
    const isOpen = expanded[section.href] ?? active;
    const row = clsx(
      'flex h-11 w-full items-center gap-3 rounded-lg px-3 text-[14px] transition-colors',
      active ? 'bg-brand font-medium text-white shadow-card' : 'text-white/70 hover:bg-white/8 hover:text-white',
      collapsed && 'lg:justify-center lg:px-0',
    );
    const label = <span className={clsx('min-w-0 flex-1 truncate text-left', collapsed && 'lg:hidden')}>{t(section.label)}</span>;

    if (pages.length === 0) {
      return (
        <li key={section.href}>
          <Link href={section.href} title={collapsed ? t(section.label) : undefined} aria-current={active ? 'page' : undefined} className={row}>
            <Icon className="size-5 shrink-0" aria-hidden />
            {label}
            {section.demo && (
              <span className={clsx('rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/60', collapsed && 'lg:hidden')}>{t('Namuna')}</span>
            )}
          </Link>
        </li>
      );
    }
    return (
      <li key={section.href}>
        {/* Yig'ilgan rejimda bo'lim birinchi sahifasiga havola, ochiq rejimda — ochib-yopiladigan guruh */}
        <Link href={pages[0]?.href ?? section.href} title={t(section.label)} className={clsx(row, 'hidden', collapsed && 'lg:flex')}>
          <Icon className="size-5 shrink-0" aria-hidden />
        </Link>
        <button type="button" onClick={() => setExpanded((e) => ({ ...e, [section.href]: !isOpen }))} aria-expanded={isOpen} className={clsx(row, collapsed && 'lg:hidden')}>
          <Icon className="size-5 shrink-0" aria-hidden />
          {label}
          <ChevronDown className={clsx('size-4 shrink-0 opacity-70 transition-transform', isOpen && 'rotate-180')} aria-hidden />
        </button>
        {isOpen && (
          <ul className={clsx('mb-1 ml-[25px] mt-1 space-y-0.5 border-l border-white/15 pl-3', collapsed && 'lg:hidden')}>
            {pages.map((page) => {
              const current = isActive(pathname, page.href);
              return (
                <li key={page.href}>
                  <Link
                    href={page.href}
                    aria-current={current ? 'page' : undefined}
                    className={clsx(
                      'flex h-9 items-center rounded-lg px-2.5 text-[13px] transition-colors',
                      current ? 'bg-white/10 font-medium text-white' : 'text-white/60 hover:bg-white/8 hover:text-white',
                    )}
                  >
                    {t(page.label)}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="min-h-dvh">
      {mobileOpen && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setMobileOpen(false)} aria-hidden />}

      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-40 flex w-[264px] flex-col bg-navy text-white transition-[width,transform] duration-200',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
          collapsed && 'lg:w-[72px]',
        )}
      >
        <div className={clsx('flex h-[72px] shrink-0 items-center gap-2 bg-navy-deep/60 px-4', collapsed && 'lg:justify-center lg:px-0')}>
          <Link href={HOME} className={clsx('flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:outline-white', collapsed && 'lg:hidden')} aria-label={t('Ish stoli')}>
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand">
              <GraduationCap className="size-[22px]" aria-hidden />
            </span>
            <span className="truncate text-xl font-semibold tracking-tight">EduCRM</span>
          </Link>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? t('Menyuni kengaytirish') : t("Menyuni yig'ish")}
            title={collapsed ? t('Menyuni kengaytirish') : t("Menyuni yig'ish")}
            className="hidden size-9 shrink-0 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white focus-visible:outline-white lg:grid"
          >
            {collapsed ? <ChevronsRight className="size-[18px]" aria-hidden /> : <ChevronsLeft className="size-[18px]" aria-hidden />}
          </button>
        </div>

        <nav aria-label={t('Asosiy navigatsiya')} className="flex-1 overflow-y-auto px-3 py-3 [&_:focus-visible]:outline-white">
          {groups.map((group, i) => (
            <div key={group.label}>
              {/* Oxirgi guruh (Boshqaruv) chiziq bilan ajratiladi */}
              {i > 0 && i === groups.length - 1 && <hr className="mx-2 my-3 border-white/15" />}
              <ul className="space-y-1" aria-label={t(group.label)}>
                {group.items.map(renderItem)}
              </ul>
              {i < groups.length - 2 && <div className="h-1" />}
            </div>
          ))}
        </nav>

        <div className={clsx('m-3 flex items-center gap-3 rounded-xl border border-white/15 p-3', collapsed && 'lg:hidden')}>
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/10">
            <Building2 className="size-[18px]" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold">{me.tenant_name}</span>
            <span className="block truncate text-xs text-white/60">
              {me.allowed_branch_ids.length ? t('{n} ta filial', { n: me.allowed_branch_ids.length }) : t('Barcha filiallar')}
            </span>
          </span>
        </div>
      </aside>

      <header
        className={clsx(
          'fixed left-0 right-0 top-0 z-20 flex h-[72px] items-center gap-3 border-b border-line bg-surface px-3 transition-[left] duration-200 sm:px-6',
          collapsed ? 'lg:left-[72px]' : 'lg:left-[264px]',
        )}
      >
        <IconButton label="Menyu" icon={Menu} onClick={() => setMobileOpen(true)} className="lg:hidden" />

        <button
          type="button"
          onClick={() => setPalette(true)}
          className="flex h-11 min-w-0 flex-1 items-center gap-3 rounded-xl bg-canvas px-4 text-left text-sm text-muted transition-colors hover:bg-brand-soft/60 sm:max-w-[460px]"
        >
          <Search className="size-[18px] shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{t("Qidiruv… (o'quvchi, sahifa, amal)")}</span>
          <kbd className="hidden text-xs font-medium sm:block">{isMac ? '⌘ K' : 'Ctrl K'}</kbd>
        </button>

        <div ref={menusRef} className="ml-auto flex items-center gap-1 sm:gap-2">
          {actions.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => toggle('actions')}
                aria-haspopup="menu"
                aria-expanded={open === 'actions'}
                className="flex h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm font-medium shadow-card hover:bg-canvas sm:px-4"
              >
                <Zap className="size-4 text-brand" aria-hidden />
                <span className="hidden md:inline">{t('Tezkor amallar')}</span>
              </button>
              {open === 'actions' && (
                <div role="menu" aria-label={t('Tezkor amallar')} className={clsx(menu, 'w-56')}>
                  {actions.map((a) => (
                    <Link key={a.href} href={a.href} role="menuitem" onClick={() => setOpen(null)} className={menuItem}>
                      <a.icon className="size-4 text-muted" aria-hidden />
                      {t(a.label)}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}

          <Link
            href="/communication/chats"
            aria-label={messages ? t("Chatlar: {n} ta o'qilmagan", { n: messages }) : t('Chatlar')}
            title={t('Chatlar')}
            className="relative hidden size-10 place-items-center rounded-lg text-ink/70 hover:bg-canvas hover:text-ink sm:grid"
          >
            <MessagesSquare className="size-5" aria-hidden />
            {messages > 0 && (
              <span className="absolute right-0.5 top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white">{messages}</span>
            )}
          </Link>
          <NotificationBell unread={counters.data?.notifications ?? 0} />
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? t("Yorug' rejim") : t("To'q rejim")}
            title={theme === 'dark' ? t("Yorug' rejim") : t("To'q rejim")}
            className="grid size-10 place-items-center rounded-lg text-ink/70 hover:bg-canvas hover:text-ink"
          >
            {theme === 'dark' ? <Sun className="size-5" aria-hidden /> : <Moon className="size-5" aria-hidden />}
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => toggle('lang')}
              aria-haspopup="menu"
              aria-expanded={open === 'lang'}
              aria-label={t('Til')}
              className="flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold hover:bg-canvas"
            >
              {lang.toUpperCase()}
              <ChevronDown className="size-4 text-muted" aria-hidden />
            </button>
            {open === 'lang' && (
              <div role="menu" aria-label={t('Til')} className={clsx(menu, 'w-44')}>
                {LANGS.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={l.id === lang}
                    onClick={() => {
                      setOpen(null);
                      setLang(l.id);
                    }}
                    className={menuItem}
                  >
                    <span className="flex-1">{t(l.label)}</span>
                    {l.id === lang && <Check className="size-4 text-brand" aria-hidden />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative border-l border-line pl-2 sm:pl-3">
            <button type="button" onClick={() => toggle('profile')} aria-haspopup="menu" aria-expanded={open === 'profile'} className="flex items-center gap-3 rounded-lg py-1 pl-1 pr-2 hover:bg-canvas">
              <Avatar name={me.full_name} src={me.photo_url} size="md" />
              <span className="hidden text-left md:block">
                <span className="block text-sm font-semibold leading-tight">{me.full_name}</span>
                <span className="block text-xs leading-tight text-muted">{roles}</span>
              </span>
              <ChevronDown className="size-4 text-muted" aria-hidden />
            </button>
            {open === 'profile' && (
              <div role="menu" className={clsx(menu, 'w-60')}>
                <div className="mb-1 border-b border-line px-2.5 pb-2.5 pt-1.5">
                  <p className="truncate text-sm font-medium">{me.full_name}</p>
                  <p className="truncate text-xs text-muted">{roles}</p>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(null);
                    photoInput.current?.click();
                  }}
                  className={menuItem}
                >
                  <Camera className="size-4 text-muted" aria-hidden />
                  {t("Rasmni o'zgartirish")}
                </button>
                <Link href="/account/security" role="menuitem" onClick={() => setOpen(null)} className={menuItem}>
                  <ShieldCheck className="size-4 text-muted" aria-hidden />
                  {t('Xavfsizlik')}
                </Link>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(null);
                    setConfirmLogout(true);
                  }}
                  className={menuItem}
                >
                  <LogOut className="size-4 text-muted" aria-hidden />
                  {t('Tizimdan chiqish')}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className={clsx('px-4 pb-12 pt-[96px] transition-[margin] duration-200 sm:px-6 lg:px-8', collapsed ? 'lg:ml-[72px]' : 'lg:ml-[264px]')}>
        <div className="mx-auto max-w-[1400px] animate-in">{children}</div>
      </main>

      <input
        ref={photoInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void apiUpload('/auth/me/photo', file).then(reload).catch(() => undefined);
        }}
      />
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
      {confirmLogout && (
        <ConfirmDialog
          title="Tizimdan chiqish"
          message="Haqiqatan ham tizimdan chiqmoqchimisiz? Qayta kirish uchun login va parol kerak bo'ladi."
          confirmLabel="Ha, chiqish"
          pending={loggingOut}
          onConfirm={() => {
            setLoggingOut(true);
            void logout();
          }}
          onClose={() => setConfirmLogout(false)}
        />
      )}
    </div>
  );
}

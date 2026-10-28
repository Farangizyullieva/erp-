'use client';

import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { CornerDownLeft, GraduationCap, Search, Users, type LucideIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { unitLabel, type StudyUnit } from '@/lib/academic';
import { api, apiPage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatPhone, studentNo } from '@/lib/format';
import { NAV_ITEMS, QUICK_ACTIONS } from '@/lib/nav';
import { t } from '@/lib/i18n';

interface Item {
  key: string;
  group: string;
  label: string;
  hint?: string;
  href: string;
  icon: LucideIcon;
}

const matches = (label: string, q: string): boolean => label.toLowerCase().replace(/['ʻ’]/g, '').includes(q.toLowerCase().replace(/['ʻ’]/g, ''));

// Global qidiruv + buyruqlar palitrasi (TZ 4.3): sahifalar, tez amallar va o'quvchilar bitta maydonda
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { can } = useAuth();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const students = useQuery({
    queryKey: ['students', 'search', debounced],
    queryFn: () => apiPage<{ id: string; number: number; full_name: string; phone: string | null; branch: { name: string } }>(`/students?limit=6&q=${encodeURIComponent(debounced)}`),
    // ID bo'yicha qidiruvda bitta raqam ham yetarli ("#7")
    enabled: can('student.view') && (debounced.length >= 2 || /^#?\d+$/.test(debounced)),
  });

  // Guruhlar: raqam ("29"), raqam + nom ("29 backend") yoki nom bo'yicha
  const units = useQuery({
    queryKey: ['study-units', 'search', debounced],
    queryFn: () => api<StudyUnit[]>(`/study-units?q=${encodeURIComponent(debounced)}`),
    enabled: can('study_unit.view') && debounced.length >= 1,
  });

  const items = useMemo<Item[]>(() => {
    const q = query.trim();
    const visible = (permissions?: string[]): boolean => !permissions?.length || can(...permissions);
    const actions = QUICK_ACTIONS.filter((a) => can(a.permission) && matches(a.label, q)).map<Item>((a) => ({
      key: `a:${a.href}`,
      group: t('Tez amallar'),
      label: t(a.label),
      href: a.href,
      icon: a.icon,
    }));
    const pages = NAV_ITEMS.filter((s) => visible(s.permissions)).flatMap<Item>((s) => {
      const children = (s.pages ?? []).filter((p) => visible(p.permissions));
      const list = children.length ? children.map((p) => ({ label: t(p.label), href: p.href, hint: t(s.label) })) : [{ label: t(s.label), href: s.href, hint: undefined }];
      return list.filter((p) => matches(`${p.label} ${p.hint ?? ''}`, q)).map((p) => ({ key: `p:${p.href}`, group: t('Sahifalar'), icon: s.icon, ...p }));
    });
    const found = (debounced.length >= 1 ? (students.data?.data ?? []) : []).map<Item>((s) => ({
      key: `s:${s.id}`,
      group: t("O'quvchilar"),
      label: s.full_name,
      hint: [studentNo(s.number), s.phone && formatPhone(s.phone), s.branch.name].filter(Boolean).join(' · '),
      href: `/students/${s.id}`,
      icon: GraduationCap,
    }));
    const groups = (debounced.length >= 1 ? (units.data ?? []) : []).slice(0, 6).map<Item>((u) => ({
      key: `u:${u.id}`,
      group: t('Guruhlar'),
      label: unitLabel(u),
      hint: [u.discipline.name, u.teacher.full_name, u.branch.name].join(' · '),
      href: `/study-units/${u.id}`,
      icon: Users,
    }));
    // Faqat raqam yozilganda guruh birinchi chiqadi ("29" → 29-guruh)
    const numeric = /^#?\d+/.test(q);
    return [...(numeric ? [...groups, ...found] : [...found, ...groups]), ...actions, ...pages];
  }, [query, debounced, students.data, units.data, can]);

  useEffect(() => setActive(0), [items.length, query]);

  const go = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    router.push(item.href);
  };
  const searching = debounced.length >= 1 && (students.isFetching || units.isFetching);

  return (
    <dialog
      ref={dialogRef}
      aria-label={t("Qidiruv va buyruqlar")}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      className="mx-auto mt-[12vh] w-[min(92vw,36rem)] animate-in overflow-hidden rounded-2xl bg-surface p-0 text-ink shadow-pop"
    >
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search className="size-[18px] shrink-0 text-muted" aria-hidden />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, items.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              go(items[active]);
            }
          }}
          placeholder={t("O'quvchi, guruh raqami, sahifa yoki amalni qidiring…")}
          role="combobox"
          aria-expanded
          aria-controls="palette-results"
          aria-activedescendant={items[active] ? `palette-${active}` : undefined}
          className="h-13 min-w-0 flex-1 bg-transparent text-[15px] placeholder:text-muted/70 focus:outline-none"
        />
        <kbd className="rounded border border-line px-1.5 py-0.5 text-[11px] text-muted">Esc</kbd>
      </div>

      <ul id="palette-results" role="listbox" className="max-h-[52vh] overflow-y-auto p-2">
        {items.length === 0 && (
          <li className="px-3 py-8 text-center text-sm text-muted">{searching ? t("Qidirilmoqda…") : query.trim() ? t("Hech narsa topilmadi") : t("Yozishni boshlang")}</li>
        )}
        {items.map((item, i) => {
          const Icon = item.icon;
          return (
            <li key={item.key} role="presentation">
              {item.group !== items[i - 1]?.group && <p className="px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{item.group}</p>}
              <button
                id={`palette-${i}`}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onClick={() => go(item)}
                className={clsx('flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm', i === active && 'bg-brand-soft text-brand-strong')}
              >
                <Icon className="size-[18px] shrink-0 opacity-70" aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{item.label}</span>
                  {item.hint && <span className={clsx('ml-2 text-[13px]', i === active ? 'text-brand-strong/70' : 'text-muted')}>{item.hint}</span>}
                </span>
                {i === active && <CornerDownLeft className="size-4 shrink-0 opacity-60" aria-hidden />}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="flex items-center gap-3 border-t border-line px-4 py-2.5 text-xs text-muted">
        <span>
          <kbd className="rounded border border-line px-1">↑</kbd> <kbd className="rounded border border-line px-1">↓</kbd> {t("tanlash")}
        </span>
        <span>
          <kbd className="rounded border border-line px-1">Enter</kbd> {t("ochish")}
        </span>
      </p>
    </dialog>
  );
}

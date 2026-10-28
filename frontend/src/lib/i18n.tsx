'use client';

import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { RU } from './ru';

export type Lang = 'uz' | 'ru';
const STORAGE_KEY = 'educrm.lang';

// Joriy til modul darajasida: t() hook emas, istalgan joydan (komponent, yordamchi funksiya) chaqiriladi.
// Til almashganda LangProvider butun daraxtni qayta quradi, shuning uchun eskirgan matn qolmaydi.
let current: Lang = 'uz';

/**
 * Tarjima kaliti — o'zbekcha matnning o'zi: t("O'quvchilar"). Tarjima topilmasa asl matn qaytadi,
 * ya'ni tarjima qilinmagan joy buzilmaydi, shunchaki o'zbekcha ko'rinadi.
 */
export function t(text: string, vars?: Record<string, string | number>): string {
  const base = current === 'ru' ? (RU[text] ?? text) : text;
  return vars ? base.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? '')) : base;
}

export const getLang = (): Lang => current;

const LangContext = createContext<{ lang: Lang; setLang: (lang: Lang) => void } | null>(null);

export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be used inside LangProvider');
  return ctx;
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('uz');
  current = lang;

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === 'ru') setLangState('ru');
    } catch {
      /* storage mavjud emas */
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage mavjud emas */
    }
    setLangState(next);
  }, []);
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);

  return (
    <LangContext.Provider value={value}>
      <Fragment key={lang}>{children}</Fragment>
    </LangContext.Provider>
  );
}

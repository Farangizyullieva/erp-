'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth, type Me } from '@/lib/auth';
import { PANELS, type Panel } from '@/lib/panels';

export { PANELS, STUDENT_HOME, STUDENT_LOGIN, type Panel } from '@/lib/panels';

/** Foydalanuvchi qaysi panelga tegishli: faqat o'quvchi/ota-ona roli → kabinet; faqat o'qituvchi roli → o'qituvchi paneli; qolganlar → admin paneli */
export function panelOf(me: Me): Panel {
  if (me.roles.length > 0 && me.roles.every((r) => r === 'student' || r === 'parent')) return 'portal';
  if (me.roles.length > 0 && me.roles.every((r) => r === 'teacher')) return 'teacher';
  return 'staff';
}
export const isPortalUser = (me: Me): boolean => panelOf(me) === 'portal';

/** Hozir qaysi panel ichida turibmiz (manzil bo'yicha) — umumiy ekranlar havolalarni shunga moslaydi */
export function usePanel(): Panel {
  const pathname = usePathname();
  return pathname.startsWith('/teacher') ? 'teacher' : pathname.startsWith('/student') ? 'portal' : 'staff';
}

/**
 * Har kim faqat o'z paneliga kiradi: boshqa panel manzilini ochsa — o'zinikiga yo'naltiriladi.
 * Bu qulaylik; haqiqiy himoya backend'da (ruxsatlar va kabinet foydalanuvchisiga xodim endpointlari yopiq).
 */
export function PanelGate({ panel, children }: { panel: Panel; children: ReactNode }) {
  const { me } = useAuth();
  const router = useRouter();
  const actual = panelOf(me);
  useEffect(() => {
    if (actual !== panel) router.replace(PANELS[actual].home);
  }, [actual, panel, router]);
  return actual !== panel ? null : <>{children}</>;
}

'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, refreshAccessToken, setAccessToken } from './api';

export interface Me {
  id: string;
  full_name: string;
  photo_url: string | null;
  tenant_name: string;
  roles: string[];
  role_names: string[];
  permissions: Record<string, 'own' | 'branch' | 'all'>;
  allowed_branch_ids: string[];
}

interface AuthState {
  me: Me;
  /** Tugmani yashirish — faqat UX; tekshiruv backend'da (TZ 3.4) */
  can: (...codes: string[]) => boolean;
  logout: () => Promise<void>;
  /** Profil o'zgargach (masalan rasm) ma'lumotni qayta oladi */
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/**
 * `loginPath` — kirilmagan bo'lsa qayerga yuboriladi; `afterLogout` — chiqqandan keyin qayerga.
 * Xodimlar va o'quvchilar panellari alohida kirish sahifasiga ega.
 */
export function AuthProvider({ children, loginPath = '/login', afterLogout = '/' }: { children: ReactNode; loginPath?: string; afterLogout?: string }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const token = await refreshAccessToken();
      const user = token ? await api<Me>('/auth/me').catch(() => null) : null;
      if (cancelled) return;
      if (user) setMe(user);
      else router.replace(loginPath);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, loginPath]);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setAccessToken(null);
    router.replace(afterLogout);
  }, [router, afterLogout]);

  const reload = useCallback(async () => setMe(await api<Me>('/auth/me')), []);

  const value = useMemo<AuthState | null>(
    () => (me ? { me, can: (...codes) => codes.some((c) => c in me.permissions), logout, reload } : null),
    [me, logout, reload],
  );

  if (!value) {
    return (
      <div className="grid min-h-dvh place-items-center" role="status" aria-label="Yuklanmoqda">
        <span className="size-7 animate-spin rounded-full border-[3px] border-brand-soft border-t-brand" />
      </div>
    );
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

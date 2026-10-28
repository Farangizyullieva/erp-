import type { ReactNode } from 'react';
import { PanelGate } from '@/components/portal-gate';
import { Shell } from '@/components/shell';
import { AuthProvider } from '@/lib/auth';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <PanelGate panel="staff">
        <Shell>{children}</Shell>
      </PanelGate>
    </AuthProvider>
  );
}

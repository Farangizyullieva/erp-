import type { ReactNode } from 'react';
import { PanelGate } from '@/components/portal-gate';
import { STUDENT_LOGIN } from '@/lib/panels';
import { AuthProvider } from '@/lib/auth';

// O'quvchi kabineti: xodimlar panelidan alohida, sodda ko'rinish (asosan telefonda ochiladi)
export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider loginPath={STUDENT_LOGIN} afterLogout={STUDENT_LOGIN}>
      <PanelGate panel="portal">{children}</PanelGate>
    </AuthProvider>
  );
}

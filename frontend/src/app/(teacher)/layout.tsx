import type { ReactNode } from 'react';
import { PanelGate } from '@/components/portal-gate';
import { PANELS } from '@/lib/panels';
import { TeacherShell } from '@/components/teacher-shell';
import { AuthProvider } from '@/lib/auth';

export default function TeacherLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider loginPath={PANELS.teacher.login} afterLogout={PANELS.teacher.login}>
      <PanelGate panel="teacher">
        <TeacherShell>{children}</TeacherShell>
      </PanelGate>
    </AuthProvider>
  );
}

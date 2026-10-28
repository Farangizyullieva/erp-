'use client';

import { DemoBanner, SubjectDot } from '@/components/demo';
import { PageHeader, Panel, StatusPill, td, th } from '@/components/ui';
import { REQUESTS, SUBJECT_COLORS } from '@/lib/demo-data';
import { t } from '@/lib/i18n';

const TONE: Record<string, 'info' | 'success' | 'neutral'> = { Yangi: 'info', 'Lidga aylantirildi': 'success', Arxivlandi: 'neutral' };

// Arizalar (TZ M2.1): tashqi manbadan kelgan xom so'rovlar — namuna ko'rinish
export default function RequestsPage() {
  return (
    <>
      <PageHeader title="Arizalar" description="Sayt, Telegram bot va landing sahifalardan kelgan so'rovlar" />
      <DemoBanner />
      <Panel className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-line bg-canvas/50">
            <tr>
              {['Sana', 'F.I.O.', 'Telefon', 'Fan / daraja', 'Filial', 'Manba', 'UTM', 'Holat'].map((h) => (
                <th key={h} className={th}>
                  {t(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {REQUESTS.map((r) => (
              <tr key={r.id} className="hover:bg-canvas/40">
                <td className={`${td} whitespace-nowrap tabular-nums text-muted`}>{r.date}</td>
                <td className={`${td} font-medium`}>{r.name}</td>
                <td className={`${td} whitespace-nowrap tabular-nums`}>{r.phone}</td>
                <td className={td}>
                  <span className="flex items-center gap-2">
                    <SubjectDot color={SUBJECT_COLORS[r.subject] ?? '#64748b'} />
                    {r.subject} <span className="text-muted">· {r.level}</span>
                  </span>
                </td>
                <td className={`${td} text-muted`}>{r.branch}</td>
                <td className={td}>{t(r.source)}</td>
                <td className={`${td} whitespace-nowrap text-xs text-muted`}>{r.utm}</td>
                <td className={td}>
                  <StatusPill tone={TONE[r.status] ?? 'neutral'}>{r.status}</StatusPill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}

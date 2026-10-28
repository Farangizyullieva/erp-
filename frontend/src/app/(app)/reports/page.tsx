'use client';

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { DemoBanner } from '@/components/demo';
import { PageHeader, Panel, td, th } from '@/components/ui';
import { FUNNEL, GROUPS, LEAD_SOURCES, SUBJECT_COLORS } from '@/lib/demo-data';
import { t } from '@/lib/i18n';

const tooltip = { borderRadius: 10, border: '1px solid var(--color-line)', background: 'var(--color-surface)', color: 'var(--color-ink)', fontSize: 13 };

// Hisobotlar (TZ M10): voronka, manbalar, guruhlar to'ldirilishi — namuna ko'rinish
export default function ReportsPage() {
  const top = FUNNEL[0]?.count ?? 1;
  const fill = GROUPS.filter((g) => g.status === 'active').map((g) => ({ name: g.name, percent: Math.round((g.students / g.capacity) * 100), subject: g.subject }));

  return (
    <>
      <PageHeader title="Hisobotlar" description="Sotuv voronkasi, reklama manbalari va guruhlar to'ldirilishi" />
      <DemoBanner />
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="p-5">
          <h2 className="text-base font-semibold">{t('Sotuv voronkasi')}</h2>
          <p className="mt-0.5 text-xs text-muted">{t('Oxirgi 30 kun')}</p>
          <ol className="mt-5 space-y-3.5">
            {FUNNEL.map((step, i) => {
              const previous = FUNNEL[i - 1]?.count;
              return (
                <li key={step.stage}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium">{t(step.stage)}</span>
                    <span className="tabular-nums">
                      <b className="font-semibold">{step.count}</b>
                      {previous && <span className="ml-2 text-xs text-muted">{Math.round((step.count / previous) * 100)}%</span>}
                    </span>
                  </div>
                  <div className="mt-1.5 h-7 overflow-hidden rounded-md bg-canvas" aria-hidden>
                    <div className="h-full rounded-md bg-brand" style={{ width: `${(step.count / top) * 100}%`, opacity: 1 - i * 0.14 }} />
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="mt-5 rounded-lg bg-canvas/70 px-3.5 py-2.5 text-[13px] text-muted">
            {t('Umumiy konversiya')}: <b className="font-semibold text-ink">{Math.round(((FUNNEL.at(-1)?.count ?? 0) / top) * 100)}%</b>
          </p>
        </Panel>

        <Panel>
          <h2 className="px-5 pt-5 text-base font-semibold">{t("Guruhlar to'ldirilishi")}</h2>
          <div className="h-80 px-2 pb-3 pt-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={fill} layout="vertical" margin={{ top: 0, right: 36, left: 12, bottom: 0 }}>
                <CartesianGrid stroke="var(--color-line)" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 11, fill: 'var(--color-muted)' }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 12, fill: 'var(--color-ink)' }} tickLine={false} axisLine={false} />
                <Tooltip cursor={{ fill: 'var(--color-canvas)' }} contentStyle={tooltip} formatter={(v) => [`${String(v)}%`, t("To'ldirilishi")]} />
                <Bar dataKey="percent" radius={[0, 6, 6, 0]} barSize={16} label={{ position: 'right', fontSize: 11, fill: 'var(--color-muted)', formatter: (v: unknown) => `${String(v)}%` }}>
                  {fill.map((g) => (
                    <Cell key={g.name} fill={SUBJECT_COLORS[g.subject] ?? '#64748b'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel className="mt-4 overflow-x-auto">
        <h2 className="px-5 pb-3 pt-5 text-base font-semibold">{t('Reklama manbalari')}</h2>
        <table className="w-full">
          <thead className="border-y border-line bg-canvas/50">
            <tr>
              <th className={th}>{t('Manba')}</th>
              <th className={`${th} text-right`}>{t('Lidlar')}</th>
              <th className={`${th} text-right`}>{t('Yozildi')}</th>
              <th className={`${th} text-right`}>{t('Konversiya')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {LEAD_SOURCES.map((s) => (
              <tr key={s.source} className="hover:bg-canvas/40">
                <td className={`${td} font-medium`}>{s.source}</td>
                <td className={`${td} text-right tabular-nums`}>{s.leads}</td>
                <td className={`${td} text-right tabular-nums`}>{s.converted}</td>
                <td className={`${td} text-right font-semibold tabular-nums`}>{Math.round((s.converted / s.leads) * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}

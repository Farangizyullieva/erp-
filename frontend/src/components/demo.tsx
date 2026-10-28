'use client';

import { FlaskConical } from 'lucide-react';
import { t } from '@/lib/i18n';

/** Namuna ma'lumotli sahifalar tepasidagi ogohlantirish: raqamlar haqiqiy emasligi har doim ko'rinib turishi kerak */
export function DemoBanner() {
  return (
    <p role="note" className="mb-4 flex items-start gap-2.5 rounded-xl border border-warning/25 bg-warning-soft px-4 py-2.5 text-[13px] text-warning">
      <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        <b className="font-semibold">{t("Namuna ma'lumot.")}</b> {t("Bu bo'lim hali backendga ulanmagan: ko'rinish tayyor, raqamlar va ismlar esa o'ylab topilgan. Amallar modul qurilgach ishlaydi.")}
      </span>
    </p>
  );
}

export const SubjectDot = ({ color }: { color: string }) => <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />;

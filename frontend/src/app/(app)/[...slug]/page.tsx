'use client';

import { Hammer } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { EmptyState, PageHeader, Panel } from '@/components/ui';
import { HOME, NAV_ITEMS } from '@/lib/nav';
import { t } from '@/lib/i18n';

// Backend moduli hali qurilmagan bo'limlar: soxta ma'lumot ko'rsatilmaydi
export default function NotBuiltYetPage() {
  const pathname = usePathname();
  const section = NAV_ITEMS.find((s) => s.href !== HOME && (pathname === s.href || pathname.startsWith(`${s.href}/`)));
  return (
    <>
      <PageHeader title={section?.label ?? t("Sahifa topilmadi")} />
      <Panel>
        <EmptyState
          icon={section?.icon ?? Hammer}
          title={section ? t("«{name}» bo'limi tez orada", { name: t(section.label) }) : t("Bunday sahifa yo'q")}
          hint={section ? t("Bu modul navbatdagi bosqichlarda quriladi. U tayyor bo'lgach shu yerda haqiqiy ma'lumot bilan ishlaydi.") : undefined}
        />
      </Panel>
    </>
  );
}

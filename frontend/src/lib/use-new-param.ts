'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

/** `?new=1` bilan kelinganda (tez amallar, buyruqlar palitrasi) formani ochadi va parametrni URL'dan olib tashlaydi */
export function useNewParam(open: () => void): void {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requested = params.get('new') === '1';

  useEffect(() => {
    if (!requested) return;
    open();
    const next = new URLSearchParams(params);
    next.delete('new');
    router.replace(next.size ? `${pathname}?${next.toString()}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);
}

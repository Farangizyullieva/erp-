import type { Tx } from './prisma.service';

/**
 * Tenant bo'yicha keyingi tartib raqami. Upsert bitta atomik so'rov: satr transaction oxirigacha qulflanadi,
 * shuning uchun parallel so'rovlar bir xil raqam olmaydi; transaction bekor bo'lsa raqam ham qaytadi (bo'shliq qolmaydi).
 */
export async function nextNumber(tx: Tx, tenantId: string, kind: 'student' | 'study_unit' | 'receipt', year = 0): Promise<number> {
  const rows = await tx.$queryRaw<{ last_value: number }[]>`
    INSERT INTO number_sequences (tenant_id, kind, year, last_value)
    VALUES (${tenantId}::uuid, ${kind}, ${year}, 1)
    ON CONFLICT (tenant_id, kind, year) DO UPDATE SET last_value = number_sequences.last_value + 1
    RETURNING last_value`;
  return (rows[0] as { last_value: number }).last_value;
}

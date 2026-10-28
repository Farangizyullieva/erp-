import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextStore } from '../context/request-context';
import type { Tx } from '../db/prisma.service';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  actorId?: string;
}

@Injectable()
export class AuditService {
  /** Biznes o'zgarishi bilan bitta transaction'da yoziladi (M11.3) */
  async write(tx: Tx, tenantId: string, entry: AuditEntry): Promise<void> {
    const ctx = RequestContextStore.get();
    await tx.auditLog.create({
      data: {
        tenantId,
        actorId: entry.actorId ?? ctx?.auth?.userId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        oldValue: toJson(entry.oldValue),
        newValue: toJson(entry.newValue),
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

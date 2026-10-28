import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { RequestContextStore } from '../context/request-context';

export type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Tenant-scoped transaction (TZ 8.4). set_config(..., true) = SET LOCAL: faqat shu transaction ichida amal qiladi,
   * connection pool'da qolib ketmaydi. Tenant jadvallariga barcha murojaat shu metod orqali — usiz RLS hech narsa ko'rsatmaydi.
   */
  tx<T>(fn: (tx: Tx) => Promise<T>, tenantId: string = RequestContextStore.auth().tenantId): Promise<T> {
    return this.$transaction(async (tx) => {
      // statement_timeout: bitta og'ir so'rov bazani band qilib qo'ymasligi uchun (DoS)
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true), set_config('statement_timeout', '15s', true)`;
      return fn(tx);
    });
  }
}

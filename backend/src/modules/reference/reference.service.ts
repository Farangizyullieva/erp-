import { Injectable } from '@nestjs/common';
import type { DictionaryItem, Holiday } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContextStore } from '../../common/context/request-context';
import { PrismaService } from '../../common/db/prisma.service';
import { AppError } from '../../common/http/app-error';
import { toDateOnly } from '../../common/utils/dates';
import { CreateDictionaryItemDto, CreateHolidayDto, DictionaryQuery, UpdateDictionaryItemDto } from './reference.dto';

const itemView = (i: DictionaryItem) => ({
  id: i.id,
  kind: i.kind,
  name: i.name,
  sort_order: i.sortOrder,
  is_active: i.isActive,
});

const holidayView = (h: Holiday) => ({
  id: h.id,
  date: toDateOnly(h.date),
  name: h.name,
  branch_id: h.branchId,
  skip_lessons: h.skipLessons,
});

@Injectable()
export class ReferenceService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listItems(query: DictionaryQuery) {
    return this.db.tx(async (tx) => {
      const rows = await tx.dictionaryItem.findMany({
        where: { kind: query.kind, isActive: query.include_inactive === 'true' ? undefined : true },
        orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      });
      return rows.map(itemView);
    });
  }

  createItem(dto: CreateDictionaryItemDto) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      await this.assertNameFree(tx, dto.kind, dto.name);
      const last = await tx.dictionaryItem.aggregate({ where: { kind: dto.kind }, _max: { sortOrder: true } });
      const item = await tx.dictionaryItem.create({
        data: { tenantId: auth.tenantId, kind: dto.kind, name: dto.name, sortOrder: (last._max.sortOrder ?? 0) + 10 },
      });
      await this.audit.write(tx, auth.tenantId, {
        action: 'dictionary.created',
        entityType: 'dictionary_item',
        entityId: item.id,
        newValue: itemView(item),
      });
      return itemView(item);
    });
  }

  updateItem(id: string, dto: UpdateDictionaryItemDto) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const before = await tx.dictionaryItem.findFirst({ where: { id } });
      if (!before) throw AppError.notFound("Ma'lumotnoma yozuvi");
      if (dto.name && dto.name !== before.name) await this.assertNameFree(tx, before.kind, dto.name, id);
      const item = await tx.dictionaryItem.update({
        where: { id },
        data: { name: dto.name, isActive: dto.is_active, sortOrder: dto.sort_order },
      });
      await this.audit.write(tx, auth.tenantId, {
        action: 'dictionary.updated',
        entityType: 'dictionary_item',
        entityId: id,
        oldValue: itemView(before),
        newValue: itemView(item),
      });
      return itemView(item);
    });
  }

  listHolidays(year: number = new Date().getUTCFullYear()) {
    return this.db.tx(async (tx) => {
      const rows = await tx.holiday.findMany({
        where: { date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
        orderBy: { date: 'asc' },
      });
      return rows.map(holidayView);
    });
  }

  createHoliday(dto: CreateHolidayDto) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const date = new Date(`${dto.date.slice(0, 10)}T00:00:00Z`);
      const clash = await tx.holiday.findFirst({ where: { date, branchId: dto.branch_id ?? null } });
      if (clash) throw AppError.field('date', 'DUPLICATE', `Bu sanada bayram allaqachon bor: ${clash.name}`);
      if (dto.branch_id && !(await tx.branch.findFirst({ where: { id: dto.branch_id }, select: { id: true } }))) {
        throw AppError.field('branch_id', 'NOT_FOUND', 'Filial topilmadi');
      }
      const holiday = await tx.holiday.create({
        data: { tenantId: auth.tenantId, date, name: dto.name, branchId: dto.branch_id, skipLessons: dto.skip_lessons },
      });
      await this.audit.write(tx, auth.tenantId, {
        action: 'holiday.created',
        entityType: 'holiday',
        entityId: holiday.id,
        newValue: holidayView(holiday),
      });
      return holidayView(holiday);
    });
  }

  deleteHoliday(id: string) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const holiday = await tx.holiday.findFirst({ where: { id } });
      if (!holiday) throw AppError.notFound('Bayram');
      await tx.holiday.delete({ where: { id } });
      await this.audit.write(tx, auth.tenantId, {
        action: 'holiday.deleted',
        entityType: 'holiday',
        entityId: id,
        oldValue: holidayView(holiday),
      });
    });
  }

  private async assertNameFree(
    tx: Parameters<Parameters<PrismaService['tx']>[0]>[0],
    kind: DictionaryItem['kind'],
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const clash = await tx.dictionaryItem.findFirst({
      where: { kind, name: { equals: name, mode: 'insensitive' }, id: exceptId ? { not: exceptId } : undefined },
    });
    if (clash) {
      throw AppError.field(
        'name',
        'DUPLICATE',
        clash.isActive ? 'Bunday nom allaqachon bor' : "Bunday nom arxivda bor — uni qayta faollashtiring",
      );
    }
  }
}

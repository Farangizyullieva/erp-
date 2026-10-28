import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { AuditService } from '../../common/audit/audit.service';
import { RequirePermission } from '../../common/auth/decorators';
import { assertBranchAccess, branchIdFilter } from '../../common/auth/scoping';
import { AuthContext, RequestContextStore } from '../../common/context/request-context';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { nextNumber } from '../../common/db/sequences';
import { AppError } from '../../common/http/app-error';
import { requirePhone } from '../../common/utils/phone';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }): unknown => (typeof value === 'string' && value.trim() === '' ? null : typeof value === 'string' ? value.trim() : value);

export const LEAD_STAGES = ['new', 'contacted', 'trial', 'contract', 'enrolled', 'lost'] as const;
type Stage = (typeof LEAD_STAGES)[number];
/** Qo'lda qo'yiladigan bosqichlar; "enrolled" faqat o'quvchiga aylantirish orqali */
const MANUAL_STAGES = ['new', 'contacted', 'trial', 'contract', 'lost'] as const;

class CreateLeadDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(150) full_name!: string;
  @IsUUID() branch_id!: string;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(30) phone?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsUUID() discipline_id?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsUUID() level_id?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsUUID() ad_source_id?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsUUID() owner_id?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(2000) note?: string | null;
}

class UpdateLeadDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(150) full_name?: string;
  @IsOptional() @IsUUID() branch_id?: string;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(30) phone?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsUUID() discipline_id?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsUUID() level_id?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsUUID() ad_source_id?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsUUID() owner_id?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(2000) note?: string | null;
  @IsOptional() @IsIn(MANUAL_STAGES) stage?: (typeof MANUAL_STAGES)[number];
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(300) lost_reason?: string | null;
}

class LeadQuery {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80) q?: string;
  @IsOptional() @IsIn(LEAD_STAGES) stage?: Stage;
  @IsOptional() @IsUUID() branch_id?: string;
  @IsOptional() @IsUUID() owner_id?: string;
}

class NoteDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(1000) text!: string;
}

const leadInclude = {
  branch: { select: { id: true, name: true } },
  discipline: { select: { id: true, name: true } },
  level: { select: { id: true, name: true } },
  adSource: { select: { id: true, name: true } },
  owner: { select: { id: true, fullName: true } },
} satisfies Prisma.LeadInclude;
type LeadRow = Prisma.LeadGetPayload<{ include: typeof leadInclude }>;

const view = (l: LeadRow, withContacts: boolean) => ({
  id: l.id,
  full_name: l.fullName,
  phone: withContacts ? l.phone : null,
  branch: l.branch,
  discipline: l.discipline,
  level: l.level,
  ad_source: l.adSource,
  owner: l.owner && { id: l.owner.id, full_name: l.owner.fullName },
  stage: l.stage,
  note: l.note,
  lost_reason: l.lostReason,
  student_id: l.studentId,
  created_at: l.createdAt,
  last_activity_at: l.lastActivityAt,
});

/** Filial scoping + `own` scope: faqat o'zi mas'ul bo'lgan lidlar (TZ 3.3) */
function leadScope(auth: AuthContext, permission: 'lead.view' | 'lead.update' | 'lead.delete'): Prisma.LeadWhereInput {
  return { branchId: branchIdFilter(auth), ownerId: auth.permissions[permission] === 'own' ? auth.userId : undefined };
}

@Injectable()
export class LeadsService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(query: LeadQuery) {
    const auth = RequestContextStore.auth();
    const canContacts = Boolean(auth.permissions['lead.view_contacts']);
    return this.db.tx(async (tx) => {
      const digits = query.q?.replace(/\D/g, '') ?? '';
      const rows = await tx.lead.findMany({
        where: {
          AND: [
            leadScope(auth, 'lead.view'),
            { branchId: query.branch_id, ownerId: query.owner_id, stage: query.stage },
            query.q ? { OR: [{ fullName: { contains: query.q, mode: 'insensitive' } }, ...(canContacts && digits.length >= 4 ? [{ phone: { contains: digits } }] : [])] } : {},
          ],
        },
        include: leadInclude,
        orderBy: { lastActivityAt: 'desc' },
        take: 500,
      });
      return rows.map((l) => view(l, canContacts));
    });
  }

  get(id: string) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const lead = await this.find(tx, auth, id, 'lead.view');
      const events = await tx.leadEvent.findMany({ where: { leadId: id }, orderBy: { createdAt: 'desc' }, take: 100 });
      const actors = await tx.user.findMany({ where: { id: { in: [...new Set(events.flatMap((e) => (e.actorId ? [e.actorId] : [])))] } }, select: { id: true, fullName: true } });
      const names = new Map(actors.map((a) => [a.id, a.fullName]));
      return {
        ...view(lead, Boolean(auth.permissions['lead.view_contacts'])),
        events: events.map((e) => ({ id: e.id, type: e.type, from_stage: e.fromStage, to_stage: e.toStage, text: e.text, actor: e.actorId ? (names.get(e.actorId) ?? null) : null, created_at: e.createdAt })),
      };
    });
  }

  create(dto: CreateLeadDto) {
    const auth = RequestContextStore.auth();
    assertBranchAccess(auth, dto.branch_id);
    const phone = dto.phone ? requirePhone(dto.phone) : null;
    return this.db.tx(async (tx) => {
      await this.assertRefs(tx, dto);
      const lead = await tx.lead.create({
        data: {
          tenantId: auth.tenantId,
          branchId: dto.branch_id,
          fullName: dto.full_name,
          phone,
          disciplineId: dto.discipline_id,
          levelId: dto.level_id,
          adSourceId: dto.ad_source_id,
          // Mas'ul ko'rsatilmasa — lidni kiritgan xodim
          ownerId: dto.owner_id ?? auth.userId,
          note: dto.note,
        },
        include: leadInclude,
      });
      await tx.leadEvent.create({ data: { tenantId: auth.tenantId, leadId: lead.id, type: 'created', toStage: 'new', actorId: auth.userId } });
      await this.audit.write(tx, auth.tenantId, { action: 'lead.created', entityType: 'lead', entityId: lead.id, newValue: { full_name: lead.fullName } });
      return view(lead, true);
    });
  }

  update(id: string, dto: UpdateLeadDto) {
    const auth = RequestContextStore.auth();
    if (dto.branch_id) assertBranchAccess(auth, dto.branch_id);
    if (dto.phone !== undefined && !auth.permissions['lead.view_contacts']) throw AppError.forbidden("Kontaktlarni o'zgartirishga ruxsat yo'q");
    const phone = dto.phone ? requirePhone(dto.phone) : dto.phone;
    return this.db.tx(async (tx) => {
      const before = await this.find(tx, auth, id, 'lead.update');
      if (before.stage === 'enrolled') throw AppError.conflict("O'quvchiga aylantirilgan lidni o'zgartirib bo'lmaydi", 'LEAD_CLOSED');
      if (dto.owner_id !== undefined && dto.owner_id !== before.ownerId && !auth.permissions['lead.change_owner']) throw AppError.forbidden("Mas'ulni o'zgartirishga ruxsat yo'q");
      await this.assertRefs(tx, dto);
      const stageChanged = dto.stage !== undefined && dto.stage !== before.stage;
      if (stageChanged && dto.stage === 'lost' && !dto.lost_reason) throw AppError.field('lost_reason', 'REQUIRED', 'Rad etish sababini yozing');
      const lead = await tx.lead.update({
        where: { id },
        data: {
          fullName: dto.full_name,
          branchId: dto.branch_id,
          phone,
          disciplineId: dto.discipline_id,
          levelId: dto.level_id,
          adSourceId: dto.ad_source_id,
          ownerId: dto.owner_id,
          note: dto.note,
          stage: dto.stage,
          // Lid qayta ochilsa rad sababi tozalanadi
          lostReason: stageChanged ? (dto.stage === 'lost' ? dto.lost_reason : null) : undefined,
          lastActivityAt: stageChanged ? new Date() : undefined,
        },
        include: leadInclude,
      });
      if (stageChanged) {
        await tx.leadEvent.create({ data: { tenantId: auth.tenantId, leadId: id, type: 'stage', fromStage: before.stage, toStage: dto.stage, text: dto.stage === 'lost' ? dto.lost_reason : null, actorId: auth.userId } });
      }
      await this.audit.write(tx, auth.tenantId, { action: 'lead.updated', entityType: 'lead', entityId: id, oldValue: { full_name: before.fullName, stage: before.stage }, newValue: { full_name: lead.fullName, stage: lead.stage } });
      return view(lead, Boolean(auth.permissions['lead.view_contacts']));
    });
  }

  addNote(id: string, dto: NoteDto) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      await this.find(tx, auth, id, 'lead.update');
      const event = await tx.leadEvent.create({ data: { tenantId: auth.tenantId, leadId: id, type: 'note', text: dto.text, actorId: auth.userId } });
      await tx.lead.update({ where: { id }, data: { lastActivityAt: new Date() } });
      return { id: event.id };
    });
  }

  /** Konversiya (M2.5): liddan o'quvchi yaratiladi, lid "o'quvchi bo'ldi" bosqichiga o'tadi — bitta transaction ichida */
  convert(id: string) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const lead = await this.find(tx, auth, id, 'lead.update');
      if (lead.studentId) throw AppError.conflict("Bu lid allaqachon o'quvchiga aylantirilgan", 'ALREADY_CONVERTED');
      const student = await tx.student.create({
        data: {
          tenantId: auth.tenantId,
          number: await nextNumber(tx, auth.tenantId, 'student'),
          branch: { connect: { id: lead.branchId } },
          owner: lead.ownerId ? { connect: { id: lead.ownerId } } : undefined,
          adSource: lead.adSourceId ? { connect: { id: lead.adSourceId } } : undefined,
          note: lead.note,
          client: { create: { tenantId: auth.tenantId, fullName: lead.fullName, phone: lead.phone } },
        },
        select: { id: true, number: true },
      });
      await tx.lead.update({ where: { id }, data: { stage: 'enrolled', studentId: student.id, lostReason: null, lastActivityAt: new Date() } });
      await tx.leadEvent.create({ data: { tenantId: auth.tenantId, leadId: id, type: 'converted', fromStage: lead.stage, toStage: 'enrolled', actorId: auth.userId } });
      await this.audit.write(tx, auth.tenantId, { action: 'student.created', entityType: 'student', entityId: student.id, newValue: { full_name: lead.fullName, from_lead: id } });
      await this.audit.write(tx, auth.tenantId, { action: 'lead.converted', entityType: 'lead', entityId: id, newValue: { full_name: lead.fullName, student_id: student.id } });
      return { student_id: student.id, student_number: student.number };
    });
  }

  remove(id: string) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const lead = await this.find(tx, auth, id, 'lead.delete');
      await tx.lead.delete({ where: { id } });
      await this.audit.write(tx, auth.tenantId, { action: 'lead.deleted', entityType: 'lead', entityId: id, oldValue: { full_name: lead.fullName, stage: lead.stage } });
    });
  }

  private async find(tx: Tx, auth: AuthContext, id: string, permission: 'lead.view' | 'lead.update' | 'lead.delete'): Promise<LeadRow> {
    const lead = await tx.lead.findFirst({ where: { AND: [{ id }, leadScope(auth, permission)] }, include: leadInclude });
    if (!lead) throw AppError.notFound('Lid');
    return lead;
  }

  private async assertRefs(tx: Tx, dto: { branch_id?: string; discipline_id?: string | null; level_id?: string | null; ad_source_id?: string | null; owner_id?: string | null }): Promise<void> {
    if (dto.branch_id && !(await tx.branch.findFirst({ where: { id: dto.branch_id, isActive: true }, select: { id: true } }))) throw AppError.field('branch_id', 'NOT_FOUND', 'Filial topilmadi yoki faol emas');
    for (const [field, kind] of [['discipline_id', 'discipline'], ['level_id', 'level'], ['ad_source_id', 'ad_source']] as const) {
      const id = dto[field];
      if (id && !(await tx.dictionaryItem.findFirst({ where: { id, kind }, select: { id: true } }))) throw AppError.field(field, 'NOT_FOUND', "Ma'lumotnoma yozuvi topilmadi");
    }
    if (dto.owner_id && !(await tx.user.findFirst({ where: { id: dto.owner_id, isActive: true }, select: { id: true } }))) throw AppError.field('owner_id', 'NOT_FOUND', 'Xodim topilmadi');
  }
}

@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @RequirePermission('lead.view')
  @Get()
  list(@Query() query: LeadQuery) {
    return this.leads.list(query);
  }

  @RequirePermission('lead.create')
  @Post()
  create(@Body() dto: CreateLeadDto) {
    return this.leads.create(dto);
  }

  @RequirePermission('lead.view')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.leads.get(id);
  }

  @RequirePermission('lead.update')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLeadDto) {
    return this.leads.update(id, dto);
  }

  @RequirePermission('lead.update')
  @Post(':id/notes')
  addNote(@Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    return this.leads.addNote(id, dto);
  }

  // Konversiya o'quvchi yaratadi — shuning uchun o'quvchi qo'shish ruxsati talab qilinadi
  @RequirePermission('student.create')
  @Post(':id/convert')
  @HttpCode(200)
  convert(@Param('id', ParseUUIDPipe) id: string) {
    return this.leads.convert(id);
  }

  @RequirePermission('lead.delete')
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.leads.remove(id);
  }
}

@Module({ controllers: [LeadsController], providers: [LeadsService] })
export class LeadsModule {}

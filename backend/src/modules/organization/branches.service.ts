import { Injectable } from '@nestjs/common';
import type { Branch, Classroom } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { assertBranchAccess, branchIdFilter } from '../../common/auth/scoping';
import { RequestContextStore } from '../../common/context/request-context';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { AppError } from '../../common/http/app-error';
import { requirePhone } from '../../common/utils/phone';
import { CreateBranchDto, CreateClassroomDto, UpdateBranchDto, UpdateClassroomDto } from './dto/organization.dto';

const branchView = (b: Branch & { _count?: { classrooms: number; users: number } }) => ({
  id: b.id,
  name: b.name,
  code: b.code,
  address: b.address,
  phone: b.phone,
  working_hours: b.workingHours,
  timezone: b.timezone,
  is_active: b.isActive,
  created_at: b.createdAt,
  classrooms_count: b._count?.classrooms,
  employees_count: b._count?.users,
});

const classroomView = (c: Classroom) => ({
  id: c.id,
  branch_id: c.branchId,
  name: c.name,
  capacity: c.capacity,
  equipment: c.equipment,
  is_active: c.isActive,
});

@Injectable()
export class BranchesService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const rows = await tx.branch.findMany({
        where: { id: branchIdFilter(auth) },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        include: { _count: { select: { classrooms: true, users: true } } },
      });
      return rows.map(branchView);
    });
  }

  get(id: string) {
    return this.db.tx(async (tx) => branchView(await this.find(tx, id)));
  }

  create(dto: CreateBranchDto) {
    const auth = RequestContextStore.auth();
    // Filial bilan cheklangan foydalanuvchi yangi filialni baribir ko'ra olmaydi
    if (auth.allowedBranchIds.length) throw AppError.forbidden();
    return this.db.tx(async (tx) => {
      const branch = await tx.branch.create({
        data: {
          tenantId: auth.tenantId,
          name: dto.name.trim(),
          code: dto.code.toUpperCase(),
          address: dto.address,
          phone: dto.phone ? requirePhone(dto.phone) : undefined,
          workingHours: dto.working_hours,
          timezone: dto.timezone,
        },
      });
      await this.audit.write(tx, auth.tenantId, {
        action: 'branch.created',
        entityType: 'branch',
        entityId: branch.id,
        newValue: branchView(branch),
      });
      return branchView(branch);
    });
  }

  /** Filial o'chirilmaydi, faqat is_active = false (TZ M1.1) */
  update(id: string, dto: UpdateBranchDto) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const before = await this.find(tx, id);
      const branch = await tx.branch.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          code: dto.code?.toUpperCase(),
          address: dto.address,
          phone: dto.phone ? requirePhone(dto.phone) : dto.phone,
          workingHours: dto.working_hours,
          timezone: dto.timezone,
          isActive: dto.is_active,
        },
      });
      await this.audit.write(tx, auth.tenantId, {
        action: 'branch.updated',
        entityType: 'branch',
        entityId: id,
        oldValue: branchView(before),
        newValue: branchView(branch),
      });
      return branchView(branch);
    });
  }

  listClassrooms(branchId: string) {
    return this.db.tx(async (tx) => {
      await this.find(tx, branchId);
      const rows = await tx.classroom.findMany({
        where: { branchId },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      });
      return rows.map(classroomView);
    });
  }

  createClassroom(branchId: string, dto: CreateClassroomDto) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      await this.find(tx, branchId);
      const room = await tx.classroom.create({
        data: { tenantId: auth.tenantId, branchId, name: dto.name.trim(), capacity: dto.capacity, equipment: dto.equipment },
      });
      await this.audit.write(tx, auth.tenantId, {
        action: 'classroom.created',
        entityType: 'classroom',
        entityId: room.id,
        newValue: classroomView(room),
      });
      return classroomView(room);
    });
  }

  updateClassroom(id: string, dto: UpdateClassroomDto) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const before = await tx.classroom.findFirst({ where: { id } });
      if (!before) throw AppError.notFound('Xona');
      assertBranchAccess(auth, before.branchId);
      const room = await tx.classroom.update({
        where: { id },
        data: { name: dto.name?.trim(), capacity: dto.capacity, equipment: dto.equipment, isActive: dto.is_active },
      });
      await this.audit.write(tx, auth.tenantId, {
        action: 'classroom.updated',
        entityType: 'classroom',
        entityId: id,
        oldValue: classroomView(before),
        newValue: classroomView(room),
      });
      return classroomView(room);
    });
  }

  private async find(tx: Tx, id: string) {
    assertBranchAccess(RequestContextStore.auth(), id);
    const branch = await tx.branch.findFirst({
      where: { id },
      include: { _count: { select: { classrooms: true, users: true } } },
    });
    if (!branch) throw AppError.notFound('Filial');
    return branch;
  }
}

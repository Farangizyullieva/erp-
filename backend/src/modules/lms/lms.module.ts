import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Prisma } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AuditService } from '../../common/audit/audit.service';
import { RequirePermission } from '../../common/auth/decorators';
import { branchIdFilter } from '../../common/auth/scoping';
import { AuthContext, RequestContextStore } from '../../common/context/request-context';
import { PrismaService, Tx } from '../../common/db/prisma.service';
import { FilesService, MAX_DOCUMENT_BYTES } from '../../common/files/files.service';
import { AppError } from '../../common/http/app-error';
import { parseDateOnly, toDateOnly } from '../../common/utils/dates';
import { todayIn } from '../academic/domain';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);
const emptyToUndefined = ({ value }: { value: unknown }): unknown => (typeof value === 'string' && value.trim() === '' ? undefined : typeof value === 'string' ? value.trim() : value);

/** Hujjat yuklash: xotirada qabul qilinadi, hajm multer darajasida ham cheklanadi */
export const documentUpload = () => FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 } });
/** multer fayl nomini latin1 deb o'qiydi — o'zbekcha/ruscha nomlar buzilmasligi uchun UTF-8 ga qaytariladi */
export const originalName = (file: Express.Multer.File): string => Buffer.from(file.originalname, 'latin1').toString('utf8');

class MaterialDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(150) title!: string;
  @IsOptional() @Transform(emptyToUndefined) @IsString() @MaxLength(2000) description?: string;
  /** Faqat http(s) havola — `javascript:` kabi sxemalar rad etiladi */
  @IsOptional() @Transform(emptyToUndefined) @IsString() @MaxLength(500) @Matches(/^https?:\/\/[^\s]+$/i, { message: "Havola http:// yoki https:// bilan boshlanishi kerak" }) link?: string;
}

class AssignmentDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(150) title!: string;
  @IsOptional() @Transform(emptyToUndefined) @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @Transform(emptyToUndefined) @IsDateString({ strict: true }) due_date?: string;
  @IsOptional() @Transform(emptyToUndefined) @Type(() => Number) @IsInt() @Min(1) @Max(1000) max_score?: number;
}

class GradeDto {
  @IsInt() @Min(0) @Max(1000) score!: number;
  @IsOptional() @Transform(emptyToUndefined) @IsString() @MaxLength(1000) feedback?: string;
}

export type FileView = { url: string | null; name: string | null; mime: string; size: number } | null;

/**
 * Ta'lim materiallari va uy vazifalari — o'qituvchi/xodim tomoni.
 * O'qituvchi (`own` scope) faqat o'zi dars beradigan guruhlarda ishlaydi; o'quvchi tomoni — PortalModule'da.
 */
@Injectable()
export class LmsService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
  ) {}

  fileView(tenantId: string, file: { id: string; name: string | null; mime: string; size: number } | null): FileView {
    return file ? { url: this.files.url(tenantId, file.id), name: file.name, mime: file.mime, size: file.size } : null;
  }

  private unitScope(auth: AuthContext, permission: 'material.manage' | 'homework.manage'): Prisma.StudyUnitWhereInput {
    return { branchId: branchIdFilter(auth), teacherId: auth.permissions[permission] === 'own' ? auth.userId : undefined };
  }

  private async unit(tx: Tx, auth: AuthContext, id: string, permission: 'material.manage' | 'homework.manage') {
    const unit = await tx.studyUnit.findFirst({ where: { AND: [{ id }, this.unitScope(auth, permission)] }, select: { id: true, name: true } });
    if (!unit) throw AppError.notFound('Guruh');
    return unit;
  }

  // ------------------------------------------------------------- darsliklar

  listMaterials(unitId: string) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      await this.unit(tx, auth, unitId, 'material.manage');
      const rows = await tx.material.findMany({ where: { studyUnitId: unitId }, orderBy: { createdAt: 'desc' }, include: { file: true } });
      return rows.map((m) => ({ id: m.id, title: m.title, description: m.description, link: m.link, file: this.fileView(auth.tenantId, m.file), created_at: m.createdAt }));
    });
  }

  createMaterial(unitId: string, dto: MaterialDto, file?: Express.Multer.File) {
    const auth = RequestContextStore.auth();
    if (!file?.buffer?.length && !dto.link) throw AppError.field('file', 'REQUIRED', "Fayl yuklang yoki havola kiriting");
    return this.db.tx(async (tx) => {
      const unit = await this.unit(tx, auth, unitId, 'material.manage');
      const fileId = file?.buffer?.length ? await this.files.saveDocument(tx, auth.tenantId, file.buffer, originalName(file), auth.userId) : null;
      const material = await tx.material.create({ data: { tenantId: auth.tenantId, studyUnitId: unitId, title: dto.title, description: dto.description, link: dto.link, fileId, createdBy: auth.userId } });
      await this.audit.write(tx, auth.tenantId, { action: 'material.created', entityType: 'study_unit', entityId: unitId, newValue: { name: unit.name, title: dto.title } });
      return { id: material.id };
    });
  }

  removeMaterial(id: string) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const material = await tx.material.findFirst({ where: { id, studyUnit: this.unitScope(auth, 'material.manage') } });
      if (!material) throw AppError.notFound('Darslik');
      await tx.material.delete({ where: { id } });
      await this.files.remove(tx, material.fileId);
      await this.audit.write(tx, auth.tenantId, { action: 'material.deleted', entityType: 'study_unit', entityId: material.studyUnitId, oldValue: { title: material.title } });
    });
  }

  // ---------------------------------------------------------------- vazifalar

  listAssignments(unitId: string) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      await this.unit(tx, auth, unitId, 'homework.manage');
      const rows = await tx.assignment.findMany({
        where: { studyUnitId: unitId },
        orderBy: { createdAt: 'desc' },
        include: { file: true, submissions: { select: { score: true } } },
      });
      return rows.map((a) => ({
        id: a.id,
        title: a.title,
        description: a.description,
        due_date: toDateOnly(a.dueDate),
        max_score: a.maxScore,
        file: this.fileView(auth.tenantId, a.file),
        created_at: a.createdAt,
        submitted: a.submissions.length,
        graded: a.submissions.filter((s) => s.score !== null).length,
      }));
    });
  }

  createAssignment(unitId: string, dto: AssignmentDto, file?: Express.Multer.File) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const unit = await this.unit(tx, auth, unitId, 'homework.manage');
      const fileId = file?.buffer?.length ? await this.files.saveDocument(tx, auth.tenantId, file.buffer, originalName(file), auth.userId) : null;
      const assignment = await tx.assignment.create({
        data: { tenantId: auth.tenantId, studyUnitId: unitId, title: dto.title, description: dto.description, dueDate: dto.due_date ? parseDateOnly(dto.due_date) : null, maxScore: dto.max_score ?? 100, fileId, createdBy: auth.userId },
      });
      await this.audit.write(tx, auth.tenantId, { action: 'assignment.created', entityType: 'study_unit', entityId: unitId, newValue: { name: unit.name, title: dto.title } });
      return { id: assignment.id };
    });
  }

  removeAssignment(id: string) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const assignment = await tx.assignment.findFirst({ where: { id, studyUnit: this.unitScope(auth, 'homework.manage') }, include: { submissions: { select: { fileId: true } } } });
      if (!assignment) throw AppError.notFound('Vazifa');
      await tx.assignment.delete({ where: { id } });
      for (const fileId of [assignment.fileId, ...assignment.submissions.map((s) => s.fileId)]) await this.files.remove(tx, fileId);
      await this.audit.write(tx, auth.tenantId, { action: 'assignment.deleted', entityType: 'study_unit', entityId: assignment.studyUnitId, oldValue: { title: assignment.title } });
    });
  }

  /** Vazifa bo'yicha guruhdagi har bir o'quvchi: topshirgan/topshirmagan, baho */
  submissions(assignmentId: string) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const assignment = await tx.assignment.findFirst({ where: { id: assignmentId, studyUnit: this.unitScope(auth, 'homework.manage') } });
      if (!assignment) throw AppError.notFound('Vazifa');
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { timezone: true } });
      const today = parseDateOnly(todayIn(tenant.timezone));
      const members = await tx.enrollment.findMany({
        where: { studyUnitId: assignment.studyUnitId, OR: [{ endDate: null }, { endDate: { gt: today } }] },
        select: { studentId: true, student: { select: { number: true, photoFileId: true, client: { select: { fullName: true } } } } },
      });
      const subs = await tx.submission.findMany({ where: { assignmentId }, include: { file: true } });
      const byStudent = new Map(subs.map((s) => [s.studentId, s]));
      // Guruhdan chiqqan bo'lsa ham topshirgan javobi ko'rinadi
      const ids = [...new Set([...members.map((m) => m.studentId), ...subs.map((s) => s.studentId)])];
      const students = await tx.student.findMany({ where: { id: { in: ids } }, select: { id: true, number: true, photoFileId: true, client: { select: { fullName: true } } } });
      return {
        assignment: { id: assignment.id, title: assignment.title, max_score: assignment.maxScore, due_date: toDateOnly(assignment.dueDate) },
        rows: students
          .map((st) => {
            const s = byStudent.get(st.id);
            return {
              student: { id: st.id, number: st.number, full_name: st.client.fullName, photo_url: this.files.url(auth.tenantId, st.photoFileId) },
              submission: s ? { id: s.id, text: s.text, file: this.fileView(auth.tenantId, s.file), submitted_at: s.submittedAt, score: s.score, feedback: s.feedback, graded_at: s.gradedAt } : null,
            };
          })
          .sort((a, b) => Number(Boolean(b.submission)) - Number(Boolean(a.submission)) || a.student.full_name.localeCompare(b.student.full_name)),
      };
    });
  }

  grade(submissionId: string, dto: GradeDto) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const submission = await tx.submission.findFirst({ where: { id: submissionId, assignment: { studyUnit: this.unitScope(auth, 'homework.manage') } }, include: { assignment: { select: { title: true, maxScore: true } } } });
      if (!submission) throw AppError.notFound('Javob');
      if (dto.score > submission.assignment.maxScore) throw AppError.field('score', 'TOO_HIGH', `Baho ${submission.assignment.maxScore} dan oshmasligi kerak`);
      await tx.submission.update({ where: { id: submissionId }, data: { score: dto.score, feedback: dto.feedback ?? null, gradedBy: auth.userId, gradedAt: new Date() } });
      await this.audit.write(tx, auth.tenantId, { action: 'submission.graded', entityType: 'student', entityId: submission.studentId, newValue: { title: submission.assignment.title, score: dto.score } });
      return { score: dto.score };
    });
  }
}

@Controller()
export class LmsController {
  constructor(private readonly lms: LmsService) {}

  @RequirePermission('material.manage')
  @Get('study-units/:id/materials')
  listMaterials(@Param('id', ParseUUIDPipe) id: string) {
    return this.lms.listMaterials(id);
  }

  @RequirePermission('material.manage')
  @Post('study-units/:id/materials')
  @UseInterceptors(documentUpload())
  createMaterial(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MaterialDto, @UploadedFile() file?: Express.Multer.File) {
    return this.lms.createMaterial(id, dto, file);
  }

  @RequirePermission('material.manage')
  @Delete('materials/:id')
  @HttpCode(204)
  removeMaterial(@Param('id', ParseUUIDPipe) id: string) {
    return this.lms.removeMaterial(id);
  }

  @RequirePermission('homework.manage')
  @Get('study-units/:id/assignments')
  listAssignments(@Param('id', ParseUUIDPipe) id: string) {
    return this.lms.listAssignments(id);
  }

  @RequirePermission('homework.manage')
  @Post('study-units/:id/assignments')
  @UseInterceptors(documentUpload())
  createAssignment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignmentDto, @UploadedFile() file?: Express.Multer.File) {
    return this.lms.createAssignment(id, dto, file);
  }

  @RequirePermission('homework.manage')
  @Delete('assignments/:id')
  @HttpCode(204)
  removeAssignment(@Param('id', ParseUUIDPipe) id: string) {
    return this.lms.removeAssignment(id);
  }

  @RequirePermission('homework.manage')
  @Get('assignments/:id/submissions')
  submissions(@Param('id', ParseUUIDPipe) id: string) {
    return this.lms.submissions(id);
  }

  @RequirePermission('homework.manage')
  @Put('submissions/:id/grade')
  grade(@Param('id', ParseUUIDPipe) id: string, @Body() dto: GradeDto) {
    return this.lms.grade(id, dto);
  }
}

@Module({ controllers: [LmsController], providers: [LmsService], exports: [LmsService] })
export class LmsModule {}

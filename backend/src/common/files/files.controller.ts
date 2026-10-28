import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Authenticated, Public, RequirePermission } from '../auth/decorators';
import { branchIdFilter } from '../auth/scoping';
import { RequestContextStore } from '../context/request-context';
import { PrismaService } from '../db/prisma.service';
import { AppError } from '../http/app-error';
import { FilesService, MAX_PHOTO_BYTES } from './files.service';

// Fayl xotirada qabul qilinadi (kichik rasmlar); hajm limiti multer darajasida ham qo'yiladi
const photo = () => FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } });
const required = (file: Express.Multer.File | undefined): Buffer => {
  if (!file?.buffer?.length) throw AppError.field('file', 'REQUIRED', 'Rasm fayli yuborilmadi');
  return file.buffer;
};

@Controller()
export class FilesController {
  constructor(
    private readonly files: FilesService,
    private readonly db: PrismaService,
  ) {}

  // Imzolangan havola orqali o'qish: token talab qilinmaydi, lekin imzo va muddat tekshiriladi
  @Public()
  @Get('files/:id')
  async read(@Param('id', ParseUUIDPipe) id: string, @Query('t', ParseUUIDPipe) tenantId: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res() res: Response): Promise<void> {
    const file = await this.files.read(id, tenantId, Number(exp), String(sig ?? ''));
    res.setHeader('Content-Type', file.mime);
    // Rasm va PDF brauzerda ochiladi; Word/ZIP — asl nomi bilan yuklab olinadi. Brauzer turini o'zi taxmin qilmasin
    const inline = file.mime.startsWith('image/') || file.mime === 'application/pdf';
    const name = file.name ? `; filename*=UTF-8''${encodeURIComponent(file.name)}` : '';
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}${name}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    // Sayt boshqa origin'da (frontend) — rasmni <img> orqali ko'rsatishga ruxsat
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.end(file.content);
  }

  @RequirePermission('student.update')
  @Post('students/:id/photo')
  @UseInterceptors(photo())
  studentPhoto(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: Express.Multer.File) {
    return this.setStudentPhoto(id, required(file));
  }

  @RequirePermission('student.update')
  @Delete('students/:id/photo')
  @HttpCode(204)
  async removeStudentPhoto(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.setStudentPhoto(id, null);
  }

  @RequirePermission('employee.update')
  @Post('employees/:id/photo')
  @UseInterceptors(photo())
  employeePhoto(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: Express.Multer.File) {
    return this.setUserPhoto(id, required(file), true);
  }

  /** Har kim o'z profil rasmini o'zi qo'ya oladi */
  @Authenticated()
  @Post('auth/me/photo')
  @UseInterceptors(photo())
  myPhoto(@UploadedFile() file?: Express.Multer.File) {
    return this.setUserPhoto(RequestContextStore.auth().userId, required(file), false);
  }

  private setStudentPhoto(studentId: string, content: Buffer | null) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const student = await tx.student.findFirst({
        where: { id: studentId, mergedIntoId: null, branchId: branchIdFilter(auth), ownerId: auth.permissions['student.update'] === 'own' ? auth.userId : undefined },
        select: { id: true, photoFileId: true },
      });
      if (!student) throw AppError.notFound("O'quvchi");
      const fileId = content ? await this.files.savePhoto(tx, auth.tenantId, content, auth.userId) : null;
      await tx.student.update({ where: { id: studentId }, data: { photoFileId: fileId } });
      await this.files.remove(tx, student.photoFileId);
      return { photo_url: this.files.url(auth.tenantId, fileId) };
    });
  }

  private setUserPhoto(userId: string, content: Buffer, scoped: boolean) {
    const auth = RequestContextStore.auth();
    return this.db.tx(async (tx) => {
      const branchId = branchIdFilter(auth);
      const user = await tx.user.findFirst({ where: { id: userId, branches: scoped && branchId ? { some: { branchId } } : undefined }, select: { id: true, photoFileId: true } });
      if (!user) throw AppError.notFound('Xodim');
      const fileId = await this.files.savePhoto(tx, auth.tenantId, content, auth.userId);
      await tx.user.update({ where: { id: userId }, data: { photoFileId: fileId } });
      await this.files.remove(tx, user.photoFileId);
      return { photo_url: this.files.url(auth.tenantId, fileId) };
    });
  }
}

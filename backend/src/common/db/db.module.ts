import { Global, Module } from '@nestjs/common';
import { AlertService } from '../alerts/alert.service';
import { AuditService } from '../audit/audit.service';
import { FilesController } from '../files/files.controller';
import { FilesService } from '../files/files.service';
import { Notifier } from '../notifications/notifier.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  controllers: [FilesController],
  providers: [PrismaService, AuditService, Notifier, AlertService, FilesService],
  exports: [PrismaService, AuditService, Notifier, AlertService, FilesService],
})
export class DbModule {}

import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { RequirePermission } from '../../common/auth/decorators';
import { MessagingService } from './messaging.service';
import { MessagingWorker } from './messaging.worker';
import { MESSENGER, TelegramProvider } from './messenger.provider';

class SendMessageBody {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString() @MinLength(1) @MaxLength(2000) text!: string;
}

class DebtReminderBody {
  /** Berilmasa — barcha qarzdorlarga */
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsUUID(undefined, { each: true }) student_ids?: string[];
  @IsOptional() @IsUUID() branch_id?: string;
  /** true — yubormasdan, faqat nechta odamga borishini ko'rsatadi */
  @IsOptional() @IsBoolean() dry_run?: boolean;
}

class SettingsBody {
  @IsOptional() @IsBoolean() weekly_report_enabled?: boolean;
  @IsOptional() @IsBoolean() payment_reminder_enabled?: boolean;
  @IsOptional() @IsBoolean() absence_notice_enabled?: boolean;
  @IsOptional() @IsBoolean() receipt_enabled?: boolean;
}

class WeeklyReportBody {
  @IsBoolean() enabled!: boolean;
}

@Controller()
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @RequirePermission('message.send')
  @Get('messaging/status')
  status() {
    return this.messaging.status();
  }

  @RequirePermission('message.send')
  @Get('messaging/log')
  log() {
    return this.messaging.log();
  }

  @RequirePermission('automation.manage')
  @Put('messaging/weekly-report')
  setWeeklyReport(@Body() body: WeeklyReportBody) {
    return this.messaging.setWeeklyReport(body.enabled);
  }

  @RequirePermission('automation.manage')
  @Put('messaging/settings')
  setSettings(@Body() body: SettingsBody) {
    return this.messaging.setSettings(body);
  }

  // Ommaviy yuborish — alohida ruxsat (TZ 3.2: message.bulk_send)
  @RequirePermission('message.bulk_send')
  @Post('messaging/debt-reminders')
  @HttpCode(200)
  debtReminders(@Body() body: DebtReminderBody) {
    return this.messaging.debtReminders({ studentIds: body.student_ids, branchId: body.branch_id, dryRun: body.dry_run ?? false });
  }

  @RequirePermission('student.update')
  @Post('students/:id/contacts/:contactId/telegram-link')
  @HttpCode(200)
  createLink(@Param('id', ParseUUIDPipe) id: string, @Param('contactId', ParseUUIDPipe) contactId: string) {
    return this.messaging.createLink(id, contactId);
  }

  @RequirePermission('message.send')
  @Post('students/:id/messages')
  send(@Param('id', ParseUUIDPipe) id: string, @Body() body: SendMessageBody) {
    return this.messaging.sendToStudent(id, body.text);
  }

  @RequirePermission('message.send')
  @Get('students/:id/weekly-report')
  weeklyPreview(@Param('id', ParseUUIDPipe) id: string) {
    return this.messaging.weeklyPreview(id);
  }
}

@Module({
  controllers: [MessagingController],
  providers: [
    MessagingService,
    MessagingWorker,
    // Token berilmagan bo'lsa null: tizim Telegram'siz ishlayveradi, tegishli amallar tushunarli xato qaytaradi
    {
      provide: MESSENGER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const token = config.get<string>('TELEGRAM_BOT_TOKEN')?.trim();
        return token ? new TelegramProvider(token) : null;
      },
    },
  ],
})
export class MessagingModule {}

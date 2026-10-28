import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/auth/decorators';
import { PrismaService } from '../common/db/prisma.service';

@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly db: PrismaService) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  // Redis tekshiruvi BullMQ ulangach qo'shiladi (TZ 16.3)
  @Get('ready')
  async ready() {
    try {
      await this.db.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Database is not reachable');
    }
    return { status: 'ok', db: 'ok' };
  }
}

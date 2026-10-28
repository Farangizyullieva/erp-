import { Controller, Get, Module, Query } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { Authenticated } from '../../common/auth/decorators';
import { DASHBOARD_PERIODS, DashboardService } from './dashboard.service';

class DashboardQuery {
  @IsOptional() @IsUUID() branch_id?: string;
  /** Dinamika grafigi davri, kunlarda */
  @IsOptional() @Transform(({ value }) => Number(value)) @IsIn(DASHBOARD_PERIODS) days?: number;
}

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  // Tarkibi servis ichida ruxsat va scope bo'yicha cheklanadi
  @Authenticated()
  @Get('summary')
  summary(@Query() query: DashboardQuery) {
    return this.dashboard.summary(query.branch_id, query.days);
  }
}

@Module({ controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AccessGuard } from './common/auth/access.guard';
import { PayloadGuard } from './common/security/payload.guard';
import { RequestContextStore } from './common/context/request-context';
import { DbModule } from './common/db/db.module';
import { AcademicModule } from './modules/academic/academic.module';
import { FinanceModule } from './modules/finance/finance.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { HealthController } from './health/health.controller';
import { InboxModule } from './modules/inbox/inbox.module';
import { IdentityModule } from './modules/identity/identity.module';
import { LeadsModule } from './modules/leads/leads.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { LmsModule } from './modules/lms/lms.module';
import { PortalModule } from './modules/portal/portal.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { ReferenceModule } from './modules/reference/reference.module';
import { StudentsModule } from './modules/students/students.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env' }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.getOrThrow<string>('JWT_ACCESS_SECRET');
        if (secret.length < 32) throw new Error('JWT_ACCESS_SECRET must be at least 32 characters');
        // Algoritm qat'iy belgilanadi: "alg: none" va algoritmni almashtirish hujumlari o'tmaydi
        return {
          secret,
          signOptions: { algorithm: 'HS256', issuer: 'educrm' },
          verifyOptions: { algorithms: ['HS256'], issuer: 'educrm' },
        };
      },
    }),
    // 300 / daq / foydalanuvchi (TZ 9.3); guard tartibi: avval limit, keyin ruxsat
    ThrottlerModule.forRoot({
      throttlers: [{ limit: 300, ttl: 60_000 }],
      skipIf: () => process.env.NODE_ENV === 'test',
      getTracker: (req) => RequestContextStore.get()?.auth?.userId ?? (req.ip as string),
    }),
    DbModule,
    IdentityModule,
    OrganizationModule,
    ReferenceModule,
    StudentsModule,
    DashboardModule,
    InboxModule,
    MessagingModule,
    AcademicModule,
    FinanceModule,
    LeadsModule,
    PortalModule,
    LmsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: PayloadGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
})
export class AppModule {}

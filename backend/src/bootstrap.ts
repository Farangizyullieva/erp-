import { INestApplication, ValidationError, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { requestContextMiddleware } from './common/context/request-context.middleware';
import { AlertService } from './common/alerts/alert.service';
import { AppError, ErrorDetail } from './common/http/app-error';
import { AllExceptionsFilter } from './common/http/exception.filter';
import { ResponseInterceptor } from './common/http/response.interceptor';

function flatten(errors: ValidationError[], parent = ''): ErrorDetail[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own = Object.entries(e.constraints ?? {}).map(([rule, message]) => ({
      field,
      code: rule === 'whitelistValidation' ? 'UNKNOWN_FIELD' : 'INVALID',
      message,
    }));
    return [...own, ...flatten(e.children ?? [], field)];
  });
}

/** main.ts va e2e testlar bir xil sozlamada ishlashi uchun */
export function configureApp(app: INestApplication): void {
  const express = app as NestExpressApplication;
  // filter[status]=active ko'rinishidagi query (TZ 9.1) — Express 5 da default "simple" parser buni ochmaydi
  express.set('query parser', 'extended');
  express.set('trust proxy', 1);
  // Birinchi bo'lib: body parser xatolari ham X-Request-Id bilan qaytishi uchun
  app.use(requestContextMiddleware);
  // Katta body bilan xotirani to'ldirishga qarshi; fayllar alohida upload endpoint'i orqali o'tadi
  express.useBodyParser('json', { limit: '200kb' });
  express.useBodyParser('urlencoded', { limit: '200kb', extended: true });
  // API faqat JSON qaytaradi: hech qanday resurs yuklanmaydi, frame ichida ochilmaydi
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      hsts: { maxAge: 31_536_000, includeSubDomains: true },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => AppError.validation(flatten(errors)),
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter(app.get(AlertService)));
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.enableShutdownHooks();
}

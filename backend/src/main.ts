
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { AlertService } from './common/alerts/alert.service';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
  });

  configureApp(app);

  app.enableCors({
    origin: (process.env.CORS_ORIGIN ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    exposedHeaders: ['X-Request-Id'],
  });

  // Xatolarni kuzatish uchun AlertService
  const alerts = app.get(AlertService);

  process.on('unhandledRejection', (reason: unknown) => {
  const message =
    reason instanceof Error
      ? `${reason.name}: ${reason.message}`
      : String(reason).slice(0, 400);

  console.error('Unhandled rejection:', message);

  try {
    alerts.send(
      'critical',
      'Ushlanmagan xato (unhandledRejection)',
      [message],
    );
  } catch (error) {
    console.error('Alert yuborilmadi:', error);
  }
});

  process.on('uncaughtException', (error: Error) => {
  console.error('Uncaught exception:', error);

  try {
    alerts.send(
      'critical',
      'Ushlanmagan xato (uncaughtException)',
      [`${error.name}: ${error.message}`],
    );
  } catch (alertError) {
    console.error('Alert yuborilmadi:', alertError);
  } finally {
    process.exit(1);
  }
});
  const port = Number(process.env.PORT ?? 3001);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT noto'g'ri qiymatga ega: ${process.env.PORT}`);
  }

  await app.listen(port, '0.0.0.0');

  console.log(`EduCRM API listening on port ${port}`);

  const server = app.getHttpServer();

  // Sekin so'rovlar bilan ulanishlarni band qilishga qarshi
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 65_000;

  // Jarayon yopilganda resurslarni to'g'ri yopish
  app.enableShutdownHooks();
}

main().catch((error: unknown) => {
  console.error('NestJS startup failed:', error);
  process.exitCode = 1;
});

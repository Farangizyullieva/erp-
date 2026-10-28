import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { AlertService } from './common/alerts/alert.service';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureApp(app);
  app.enableCors({ origin: (process.env.CORS_ORIGIN ?? '').split(',').filter(Boolean), exposedHeaders: ['X-Request-Id'] });
  // Hech qayerda ushlanmagan xatolar: jarayon yiqilishidan oldin xabar beriladi
  const alerts = app.get(AlertService);
  process.on('unhandledRejection', (reason) => alerts.send('critical', 'Ushlanmagan xato (unhandledRejection)', [reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason).slice(0, 400)]));
  process.on('uncaughtException', (error) => {
    alerts.send('critical', 'Ushlanmagan xato (uncaughtException)', [`${error.name}: ${error.message}`]);
    console.error(error);
  });

  const server = await app.listen(Number(process.env.PORT ?? 3001));
  // Sekin so'rovlar bilan ulanishlarni band qilishga (slowloris) qarshi
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 65_000;
}

void main();

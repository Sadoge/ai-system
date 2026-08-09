import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { pino } from 'pino';
import { AppModule } from './app.module.js';
import { DomainExceptionFilter } from './domain-exception.filter.js';

const log = pino({ name: 'api', level: process.env.LOG_LEVEL ?? 'info' });

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false,
  });
  app.setGlobalPrefix('api');
  app.enableCors();

  // Auth, tenancy, roles and rate limiting are enforced by AuthGuard on every
  // route (see auth.ts). There is no ambient token check here any more.
  app.useGlobalFilters(new DomainExceptionFilter());

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
  log.info({ port }, 'api listening');
}

bootstrap().catch((err) => {
  log.error({ err }, 'api failed to start');
  process.exit(1);
});

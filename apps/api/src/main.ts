import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { pino } from 'pino';
import { AppModule } from './app.module.js';

const log = pino({ name: 'api', level: process.env.LOG_LEVEL ?? 'info' });

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false,
  });
  app.setGlobalPrefix('api');
  app.enableCors();

  // Single-user auth (docs/10 MVP delivery): a static bearer token. If
  // API_TOKEN is unset the API is open — local development only. The Jira
  // webhook authenticates with its own shared secret instead.
  const token = process.env.API_TOKEN;
  if (token) {
    const webhookSecret = process.env.JIRA_WEBHOOK_SECRET;
    app
      .getHttpAdapter()
      .getInstance()
      .addHook('onRequest', async (req, reply) => {
        if (req.url.startsWith('/api/webhooks/jira')) {
          const url = new URL(req.url, 'http://localhost');
          if (webhookSecret && url.searchParams.get('secret') === webhookSecret) return;
        }
        if (req.headers.authorization !== `Bearer ${token}`) {
          reply.code(401).send({ message: 'unauthorized' });
        }
      });
  } else {
    log.warn('API_TOKEN not set — API is unauthenticated (local dev only)');
  }

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
  log.info({ port }, 'api listening');
}

bootstrap().catch((err) => {
  log.error({ err }, 'api failed to start');
  process.exit(1);
});

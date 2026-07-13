import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { parseServiceConfig } from '@eldercare/config';
import { AppModule } from './app.module.js';
import { SafeNestLogger } from './common/nest-logger.js';
import { configureHttpApplication, setupOpenApi } from './http-application.js';

async function bootstrap(): Promise<void> {
  const config = parseServiceConfig();
  const logger = new SafeNestLogger(config.logLevel);
  const app = await NestFactory.create(AppModule, { logger });

  configureHttpApplication(app, config);
  setupOpenApi(app, config);

  await app.listen(config.apiPort, '0.0.0.0');
  logger.log(`API started on configured port ${config.apiPort}`, 'Bootstrap');
}

void bootstrap();

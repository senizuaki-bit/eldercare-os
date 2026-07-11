import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { parseServiceConfig } from '@eldercare/config';
import { createLogger } from '@eldercare/observability';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { SafeExceptionFilter } from './common/safe-exception.filter.js';

async function bootstrap(): Promise<void> {
  const config = parseServiceConfig();
  const logger = createLogger({ service: 'api', level: config.logLevel });
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.use(helmet());
  app.enableCors({
    credentials: true,
    methods: ['GET', 'HEAD', 'OPTIONS'],
    origin: config.corsOrigins
  });
  app.useGlobalFilters(new SafeExceptionFilter());
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Eldercare Operations API')
      .setDescription('M00 foundation endpoints. Business APIs are intentionally not implemented yet.')
      .setVersion(config.appVersion)
      .build()
  );
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'openapi.json' });

  await app.listen(config.apiPort, '0.0.0.0');
  logger.info('API started', { port: config.apiPort });
}

void bootstrap();

import type { INestApplication } from '@nestjs/common';
import type { ServiceConfig } from '@eldercare/config';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import helmet from 'helmet';
import { SafeExceptionFilter } from './common/safe-exception.filter.js';

export function configureHttpApplication(
  app: INestApplication,
  config: ServiceConfig,
): void {
  app.use(helmet());
  app.enableCors({
    allowedHeaders: ['content-type', 'x-correlation-id', 'x-csrf-token'],
    credentials: true,
    methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT'],
    origin: config.corsOrigins,
  });
  app.useGlobalFilters(new SafeExceptionFilter());
  app.enableShutdownHooks();
}

export function createOpenApiDocument(
  app: INestApplication,
  config: Pick<ServiceConfig, 'appVersion'>,
): OpenAPIObject {
  return SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Eldercare Operations API')
      .setDescription(
        'M03 tenant-aware elder records, private voice requests, deterministic risk review and auditable work orders.',
      )
      .setVersion(config.appVersion)
      .addCookieAuth('eldercare_session', {
        type: 'apiKey',
        in: 'cookie',
        name: 'eldercare_session',
        description: 'Opaque local-demo session cookie; the server stores only its hash.',
      }, 'sessionCookie')
      .addApiKey(
        {
          type: 'apiKey',
          in: 'header',
          name: 'x-csrf-token',
          description: 'Required for authenticated state-changing requests.',
        },
        'csrf',
      )
      .build(),
  );
}

export function setupOpenApi(app: INestApplication, config: Pick<ServiceConfig, 'appVersion'>): void {
  const document = createOpenApiDocument(app, config);
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'openapi.json' });
}

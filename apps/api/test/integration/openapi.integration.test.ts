import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { SwaggerModule } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';
import type { ServiceConfig } from '@eldercare/config';
import { afterEach, describe, expect, it } from 'vitest';
import { HealthController } from '../../src/health/health.controller.js';
import { ReadinessService } from '../../src/health/readiness.service.js';
import { SERVICE_CONFIG } from '../../src/tokens.js';

describe('OpenAPI health contract', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it('publishes concrete response schemas for ready and unavailable states', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: SERVICE_CONFIG, useValue: { appVersion: 'openapi-test' } satisfies Partial<ServiceConfig> },
        { provide: ReadinessService, useValue: { check: () => Promise.resolve({ postgres: 'ok', redis: 'ok' }) } }
      ]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    const document = SwaggerModule.createDocument(app, {
      info: { title: 'test', version: '1' },
      openapi: '3.0.0'
    });
    const serialized = JSON.stringify(document.paths['/health/ready']?.get?.responses);

    expect(serialized).toContain('HealthResponseDto');
    expect(serialized).toContain('200');
    expect(serialized).toContain('503');
  });
});

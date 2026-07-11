import 'reflect-metadata';
import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { ServiceConfig } from '@eldercare/config';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { HealthController } from '../../src/health/health.controller.js';
import { ReadinessService } from '../../src/health/readiness.service.js';
import { SERVICE_CONFIG } from '../../src/tokens.js';

describe('health endpoints', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it('keeps liveness healthy while readiness reports a dependency failure', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: SERVICE_CONFIG, useValue: { appVersion: 'integration-test' } satisfies Partial<ServiceConfig> },
        { provide: ReadinessService, useValue: { check: () => Promise.resolve({ postgres: 'ok', redis: 'error' }) } }
      ]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    const server = app.getHttpServer() as Server;
    await request(server).get('/health/live').expect(200).expect(({ body }: { body: { status?: string } }) => {
      expect(body.status).toBe('ok');
    });
    await request(server).get('/health/ready').expect(503).expect(({ body }: { body: unknown }) => {
      expect(body).toMatchObject({ status: 'error', checks: { postgres: 'ok', redis: 'error' } });
      expect(JSON.stringify(body)).not.toMatch(/url|password|secret|stack/i);
    });
  });
});

import { parseServiceConfig } from '@eldercare/config';
import { describe, expect, it } from 'vitest';
import { ReadinessService } from '../../src/health/readiness.service.js';

describe('API infrastructure readiness', () => {
  it('queries real PostgreSQL and Redis dependencies', async () => {
    const service = new ReadinessService(parseServiceConfig());

    try {
      await expect(service.check()).resolves.toEqual({ postgres: 'ok', redis: 'ok' });
    } finally {
      await service.onModuleDestroy();
    }
  });
});

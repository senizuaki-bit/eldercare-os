import { parseServiceConfig } from '@eldercare/config';
import { describe, expect, it } from 'vitest';
import { createDependencyProbe } from '../../src/probes.js';

describe('worker infrastructure readiness', () => {
  it('queries real PostgreSQL and Redis dependencies', async () => {
    const config = parseServiceConfig();
    const probe = createDependencyProbe(config.databaseUrl, config.redisUrl, config.readinessTimeoutMs);

    try {
      await expect(probe.check()).resolves.toEqual({ postgres: 'ok', redis: 'ok' });
    } finally {
      await probe.close();
    }
  });
});

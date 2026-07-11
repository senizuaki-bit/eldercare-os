import { describe, expect, it } from 'vitest';
import type { ServiceConfig } from '@eldercare/config';
import { HealthController } from './health.controller.js';

const config = { appVersion: 'test-version' } as ServiceConfig;

describe('HealthController', () => {
  it('returns a minimal live response', () => {
    const controller = new HealthController({ check: () => Promise.resolve({ postgres: 'ok', redis: 'ok' }) } as never, config);
    const response = controller.live();

    expect(response).toMatchObject({ service: 'api', status: 'ok', version: 'test-version' });
    expect(JSON.stringify(response)).not.toMatch(/password|databaseUrl|redisUrl/i);
  });
});

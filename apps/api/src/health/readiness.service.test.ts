import type { ServiceConfig } from '@eldercare/config';
import { describe, expect, it, vi } from 'vitest';
import { ReadinessService, type ReadinessDependencies } from './readiness.service.js';

const config = {
  databaseUrl: 'postgresql://test:test@127.0.0.1:5432/test',
  redisUrl: 'redis://127.0.0.1:6379',
  readinessTimeoutMs: 100
} as ServiceConfig;

describe('ReadinessService', () => {
  it('recovers a Redis probe after an initial connection failure', async () => {
    let redisStatus: ReadinessDependencies['redis']['status'] = 'end';
    const connect = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => Promise.reject(new Error('offline')))
      .mockImplementationOnce(() => {
        redisStatus = 'ready';
        return Promise.resolve();
      });
    const dependencies = {
      pool: { query: vi.fn(() => Promise.resolve()), end: vi.fn(() => Promise.resolve()) },
      redis: {
        get status() {
          return redisStatus;
        },
        connect,
        ping: vi.fn(() => Promise.resolve('PONG')),
        quit: vi.fn(() => Promise.resolve('OK'))
      }
    } as unknown as ReadinessDependencies;
    const service = new ReadinessService(config, dependencies);

    await expect(service.check()).resolves.toEqual({ postgres: 'ok', redis: 'error' });
    await expect(service.check()).resolves.toEqual({ postgres: 'ok', redis: 'ok' });
    expect(connect).toHaveBeenCalledTimes(2);
  });
});

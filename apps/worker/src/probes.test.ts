import { describe, expect, it, vi } from 'vitest';
import { createDependencyProbeFromClients, type ProbeClients } from './probes.js';

describe('createDependencyProbeFromClients', () => {
  it('reconnects after Redis transitions to end', async () => {
    let status: ProbeClients['redis']['status'] = 'end';
    const connect = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => Promise.reject(new Error('offline')))
      .mockImplementationOnce(() => {
        status = 'ready';
        return Promise.resolve();
      });
    const clients = {
      pool: { query: vi.fn(() => Promise.resolve()), end: vi.fn(() => Promise.resolve()) },
      redis: {
        get status() {
          return status;
        },
        connect,
        ping: vi.fn(() => Promise.resolve('PONG')),
        quit: vi.fn(() => Promise.resolve('OK'))
      }
    } as unknown as ProbeClients;
    const probe = createDependencyProbeFromClients(clients, 100);

    await expect(probe.check()).resolves.toEqual({ postgres: 'ok', redis: 'error' });
    await expect(probe.check()).resolves.toEqual({ postgres: 'ok', redis: 'ok' });
  });
});

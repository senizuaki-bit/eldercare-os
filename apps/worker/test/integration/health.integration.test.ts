import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createHealthServer } from '../../src/health-server.js';

describe('worker health integration', () => {
  it('serves liveness over HTTP', async () => {
    const server = createHealthServer({
      appVersion: 'integration',
      probe: { check: () => Promise.resolve({ postgres: 'ok', redis: 'ok' }) }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server port');

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/health/live`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ service: 'worker', status: 'ok' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

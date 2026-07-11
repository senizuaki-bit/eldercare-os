import { once } from 'node:events';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createHealthServer } from './health-server.js';

describe('worker health server', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  it('reports readiness without exposing connection details', async () => {
    const server = createHealthServer({
      appVersion: 'test',
      probe: { check: () => Promise.resolve({ postgres: 'ok', redis: 'error' }) }
    });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server port');

    const response = await fetch(`http://127.0.0.1:${address.port}/health/ready`);
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toContain('"redis":"error"');
    expect(body).not.toMatch(/password|secret|redis:\/\/|postgresql:\/\//i);
  });
});

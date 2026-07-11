import { createServer, type Server, type ServerResponse } from 'node:http';
import type { HealthResponse } from '@eldercare/contracts';
import type { DependencyProbe } from './probes.js';

interface HealthServerOptions {
  appVersion: string;
  probe: Pick<DependencyProbe, 'check'>;
}

export function createHealthServer(options: HealthServerOptions): Server {
  return createServer((request, response) => {
    void handleRequest(request.url ?? '/', response, options);
  });
}

async function handleRequest(
  path: string,
  response: ServerResponse,
  options: HealthServerOptions
): Promise<void> {
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');

  if (path === '/health/live') {
    send(response, 200, health(options.appVersion, 'ok'));
    return;
  }

  if (path === '/health/ready') {
    const checks = await options.probe.check();
    const ready = Object.values(checks).every((status) => status === 'ok');
    send(response, ready ? 200 : 503, health(options.appVersion, ready ? 'ok' : 'error', checks));
    return;
  }

  send(response, 404, {
    error: { code: 'HTTP_404', message: '资源不存在', correlationId: 'worker-health' },
    timestamp: new Date().toISOString()
  });
}

function health(version: string, status: HealthResponse['status'], checks?: HealthResponse['checks']): HealthResponse {
  return {
    service: 'worker',
    status,
    version,
    timestamp: new Date().toISOString(),
    ...(checks ? { checks } : {})
  };
}

function send(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.end(JSON.stringify(body));
}

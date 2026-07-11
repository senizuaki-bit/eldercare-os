import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

const startupTimeoutMs = 30_000;
const services = [
  {
    name: 'api',
    entry: resolve('apps/api/dist/main.js'),
    environment: { API_PORT: '4100' },
    baseUrl: 'http://127.0.0.1:4100'
  },
  {
    name: 'worker',
    entry: resolve('apps/worker/dist/main.js'),
    environment: { WORKER_PORT: '4101' },
    baseUrl: 'http://127.0.0.1:4101'
  }
];

const children = services.map((service) => {
  const logs = [];
  const child = spawn(process.execPath, [service.entry], {
    env: { ...process.env, ...service.environment },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  return { ...service, child, logs };
});

async function fetchHealth(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
  const body = await response.json();
  return { response, body };
}

async function waitForHealthy(service) {
  const deadline = Date.now() + startupTimeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    if (service.child.exitCode !== null) {
      throw new Error(`${service.name} exited with code ${service.child.exitCode}`);
    }

    try {
      const live = await fetchHealth(`${service.baseUrl}/health/live`);
      const ready = await fetchHealth(`${service.baseUrl}/health/ready`);
      if (
        live.response.status === 200 &&
        live.body.status === 'ok' &&
        ready.response.status === 200 &&
        ready.body.status === 'ok' &&
        ready.body.checks?.postgres === 'ok' &&
        ready.body.checks?.redis === 'ok'
      ) {
        return;
      }
      lastError = new Error(
        `${service.name} returned live=${live.response.status}, ready=${ready.response.status}`
      );
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }

  throw lastError ?? new Error(`${service.name} did not become healthy`);
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000))
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

try {
  await Promise.all(children.map(waitForHealthy));
  console.log('API and worker live/readiness smoke checks passed.');
} catch (error) {
  for (const service of children) {
    const output = service.logs.join('').trim();
    if (output) console.error(`${service.name} output:\n${output}`);
  }
  throw error;
} finally {
  await Promise.all(children.map(({ child }) => stop(child)));
}

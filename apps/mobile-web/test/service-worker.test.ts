/* @vitest-environment node */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

interface InstallEventMock {
  waitUntil(operation: Promise<unknown>): void;
}

interface FetchRequestMock {
  readonly destination: string;
  readonly method: string;
  readonly mode: string;
  readonly url: string;
}

interface FetchEventMock {
  readonly request: FetchRequestMock;
  respondWith(operation: Promise<Response>): void;
}

function createServiceWorkerHarness() {
  const source = readFileSync(resolve(process.cwd(), 'public', 'sw.js'), 'utf8');
  const listeners = new Map<string, (event: unknown) => void>();
  const cachedResponses = new Map<string, Response>();
  const addAll = vi.fn((routes: string[]) => {
    for (const route of routes) {
      cachedResponses.set(route, new Response(`<main>${route}</main>`));
    }
    return Promise.resolve();
  });
  const runtimePut = vi.fn(() => Promise.resolve());
  const fetchMock = vi.fn(() => Promise.reject(new Error('network unavailable')));
  const cache = { addAll, put: runtimePut };
  const cachesMock = {
    delete: vi.fn(() => Promise.resolve(true)),
    keys: vi.fn(() => Promise.resolve([])),
    match: vi.fn((request: string | FetchRequestMock) => {
      const key = typeof request === 'string' ? request : new URL(request.url).pathname;
      return Promise.resolve(cachedResponses.get(key));
    }),
    open: vi.fn(() => Promise.resolve(cache))
  };
  const selfMock = {
    addEventListener(type: string, listener: (event: unknown) => void) {
      listeners.set(type, listener);
    },
    clients: { claim: vi.fn() },
    location: { origin: 'http://127.0.0.1:3001' },
    skipWaiting: vi.fn()
  };

  vm.runInNewContext(source, {
    caches: cachesMock,
    fetch: fetchMock,
    Response,
    self: selfMock,
    Set,
    URL
  });

  return { addAll, cachedResponses, fetchMock, listeners };
}

describe('mobile service worker behavior', () => {
  it('pre-caches the offline page and elder shell during installation', async () => {
    const { addAll, listeners } = createServiceWorkerHarness();
    const install = listeners.get('install');
    let installation: Promise<unknown> | undefined;

    expect(install).toBeTypeOf('function');
    install?.({
      waitUntil(operation: Promise<unknown>) {
        installation = operation;
      }
    } satisfies InstallEventMock);
    await installation;

    expect(addAll).toHaveBeenCalledWith(['/offline', '/m/elder/home']);
  });

  it('serves the cached offline page when an uncached navigation cannot reach the network', async () => {
    const { cachedResponses, fetchMock, listeners } = createServiceWorkerHarness();
    cachedResponses.set('/offline', new Response('<main><h1>暂时无法连接</h1></main>'));
    const handleFetch = listeners.get('fetch');
    let responsePromise: Promise<Response> | undefined;

    expect(handleFetch).toBeTypeOf('function');
    handleFetch?.({
      request: {
        destination: 'document',
        method: 'GET',
        mode: 'navigate',
        url: 'http://127.0.0.1:3001/not-cached-during-install'
      },
      respondWith(operation: Promise<Response>) {
        responsePromise = operation;
      }
    } satisfies FetchEventMock);

    expect(await (await responsePromise)?.text()).toContain('暂时无法连接');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

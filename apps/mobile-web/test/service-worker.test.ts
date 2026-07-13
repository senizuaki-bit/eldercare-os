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

interface MessageEventMock {
  readonly data: unknown;
  waitUntil(operation: Promise<unknown>): void;
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
  const cachePut = vi.fn(() => Promise.resolve());
  const fetchMock = vi.fn(() => Promise.reject(new Error('network unavailable')));
  const cache = { addAll, put: cachePut };
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

  return { addAll, cachedResponses, cachesMock, fetchMock, listeners };
}

function runFetch(
  listeners: Map<string, (event: unknown) => void>,
  request: FetchRequestMock
): Promise<Response> | undefined {
  let responsePromise: Promise<Response> | undefined;
  listeners.get('fetch')?.({
    request,
    respondWith(operation: Promise<Response>) {
      responsePromise = operation;
    }
  } satisfies FetchEventMock);
  return responsePromise;
}

describe('mobile service worker behavior', () => {
  it('pre-caches only the public offline page during installation', async () => {
    const { addAll, listeners } = createServiceWorkerHarness();
    let installation: Promise<unknown> | undefined;

    listeners.get('install')?.({
      waitUntil(operation: Promise<unknown>) {
        installation = operation;
      }
    } satisfies InstallEventMock);
    await installation;

    expect(addAll).toHaveBeenCalledWith(['/offline']);
    expect(JSON.stringify(addAll.mock.calls)).not.toContain('/m/');
  });

  it('uses the public offline page only for public navigation failures', async () => {
    const { cachedResponses, fetchMock, listeners } = createServiceWorkerHarness();
    cachedResponses.set('/offline', new Response('<main><h1>暂时无法连接</h1></main>'));

    const responsePromise = runFetch(listeners, {
      destination: 'document',
      method: 'GET',
      mode: 'navigate',
      url: 'http://127.0.0.1:3001/login'
    });

    expect(await (await responsePromise)?.text()).toContain('暂时无法连接');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('keeps protected portal navigation network-only and never reads a cache', async () => {
    const { cachesMock, fetchMock, listeners } = createServiceWorkerHarness();

    const responsePromise = runFetch(listeners, {
      destination: 'document',
      method: 'GET',
      mode: 'navigate',
      url: 'http://127.0.0.1:3001/m/elder/home'
    });
    const response = await responsePromise;

    expect(response?.status).toBe(503);
    expect(await response?.text()).toContain('受保护内容不会从缓存中恢复');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(cachesMock.match).not.toHaveBeenCalled();
    expect(cachesMock.open).not.toHaveBeenCalled();
  });

  it('keeps cross-origin API mutations network-only and out of caches', async () => {
    const { cachesMock, fetchMock, listeners } = createServiceWorkerHarness();

    const responsePromise = runFetch(listeners, {
      destination: '',
      method: 'POST',
      mode: 'cors',
      url: 'http://127.0.0.1:4000/auth/logout'
    });
    const response = await responsePromise;

    expect(response?.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(cachesMock.match).not.toHaveBeenCalled();
    expect(cachesMock.open).not.toHaveBeenCalled();
  });

  it('clears the runtime static cache after logout or principal change', async () => {
    const { cachesMock, listeners } = createServiceWorkerHarness();
    let cleanup: Promise<unknown> | undefined;

    listeners.get('message')?.({
      data: { type: 'CLEAR_PRIVATE_DATA' },
      waitUntil(operation: Promise<unknown>) {
        cleanup = operation;
      }
    } satisfies MessageEventMock);
    await cleanup;

    expect(cachesMock.delete).toHaveBeenCalledWith('eldercare-mobile-static-v3');
  });
});

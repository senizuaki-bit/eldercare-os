/* global self, caches, fetch, Response, URL */

const CACHE_VERSION = 'v2';
const CACHE_PREFIX = 'eldercare-mobile';
const SHELL_CACHE = `${CACHE_PREFIX}-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}-runtime-${CACHE_VERSION}`;
const SHELL_ROUTES = ['/offline', '/m/elder/home'];
const CACHEABLE_DESTINATIONS = new Set(['font', 'image', 'manifest', 'script', 'style']);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ROUTES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith(`${CACHE_PREFIX}-`) && key !== SHELL_CACHE && key !== RUNTIME_CACHE
            )
            .map((key) => caches.delete(key))
        )
      )
  );
  self.clients.claim();
});

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);

    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      await cache.put(request, response.clone());
    }

    return response;
  } catch {
    const cachedPage = await caches.match(request);
    const offlinePage = await caches.match('/offline');

    return (
      cachedPage ??
      offlinePage ??
      new Response('当前网络不可用，请稍后重试。', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        status: 503
      })
    );
  }
}

function shouldRuntimeCache(request) {
  if (request.method !== 'GET') {
    return false;
  }

  const requestUrl = new URL(request.url);
  return (
    requestUrl.origin === self.location.origin &&
    (CACHEABLE_DESTINATIONS.has(request.destination) || requestUrl.pathname.startsWith('/_next/static/'))
  );
}

async function cacheFirstAsset(request) {
  const cachedResponse = await caches.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  const response = await fetch(request);

  if (response.ok && response.type === 'basic') {
    const cache = await caches.open(RUNTIME_CACHE);
    await cache.put(request, response.clone());
  }

  return response;
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(event.request));
    return;
  }

  if (shouldRuntimeCache(event.request)) {
    event.respondWith(cacheFirstAsset(event.request));
  }
});

/* global self, caches, fetch, Response, URL */

const CACHE_VERSION = 'v3';
const CACHE_PREFIX = 'eldercare-mobile';
const PUBLIC_CACHE = `${CACHE_PREFIX}-public-${CACHE_VERSION}`;
const STATIC_CACHE = `${CACHE_PREFIX}-static-${CACHE_VERSION}`;
const PUBLIC_OFFLINE_ROUTE = '/offline';
const CACHEABLE_DESTINATIONS = new Set(['font', 'image', 'manifest', 'script', 'style']);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(PUBLIC_CACHE).then((cache) => cache.addAll([PUBLIC_OFFLINE_ROUTE])));
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
                key.startsWith(`${CACHE_PREFIX}-`) && key !== PUBLIC_CACHE && key !== STATIC_CACHE
            )
            .map((key) => caches.delete(key))
        )
      )
  );
  self.clients.claim();
});

function isProtectedRequest(request) {
  const requestUrl = new URL(request.url);

  if (requestUrl.origin !== self.location.origin) {
    return true;
  }

  return (
    requestUrl.pathname === '/m' ||
    requestUrl.pathname.startsWith('/m/') ||
    requestUrl.pathname === '/api' ||
    requestUrl.pathname.startsWith('/api/') ||
    requestUrl.pathname === '/auth' ||
    requestUrl.pathname.startsWith('/auth/')
  );
}

async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch {
    return new Response('当前网络不可用。为保护隐私，受保护内容不会从缓存中恢复。', {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8'
      },
      status: 503
    });
  }
}

async function publicNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    return (
      (await caches.match(PUBLIC_OFFLINE_ROUTE)) ??
      new Response('当前网络不可用，请稍后重试。', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        status: 503
      })
    );
  }
}

function shouldCacheStaticAsset(request) {
  if (request.method !== 'GET') {
    return false;
  }

  const requestUrl = new URL(request.url);
  return (
    requestUrl.origin === self.location.origin &&
    (CACHEABLE_DESTINATIONS.has(request.destination) || requestUrl.pathname.startsWith('/_next/static/'))
  );
}

async function cacheFirstStaticAsset(request) {
  const cachedResponse = await caches.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  const response = await fetch(request);

  if (response.ok && response.type === 'basic') {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response.clone());
  }

  return response;
}

self.addEventListener('fetch', (event) => {
  if (isProtectedRequest(event.request)) {
    event.respondWith(networkOnly(event.request));
    return;
  }

  if (event.request.method !== 'GET') {
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(publicNavigation(event.request));
    return;
  }

  if (shouldCacheStaticAsset(event.request)) {
    event.respondWith(cacheFirstStaticAsset(event.request));
  }
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'CLEAR_PRIVATE_DATA') {
    event.waitUntil(caches.delete(STATIC_CACHE));
  }
});

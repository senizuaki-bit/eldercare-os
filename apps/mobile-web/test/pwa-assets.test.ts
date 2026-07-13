import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import createManifest from '../app/manifest';

describe('mobile PWA metadata', () => {
  it('starts at the session entry route and declares installable icons', () => {
    const manifest = createManifest();

    expect(manifest.start_url).toBe('/');
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: '192x192', src: '/icons/icon-192.png', type: 'image/png' }),
        expect.objectContaining({ sizes: '512x512', src: '/icons/icon-512.png', type: 'image/png' })
      ])
    );
  });
});

describe('mobile service worker', () => {
  const source = readFileSync(resolve(process.cwd(), 'public', 'sw.js'), 'utf8');

  it('uses versioned public and static caches without pre-caching a portal', () => {
    expect(source).toContain("const CACHE_VERSION = 'v3'");
    expect(source).toContain('PUBLIC_CACHE');
    expect(source).toContain('STATIC_CACHE');
    expect(source).toContain("cache.addAll([PUBLIC_OFFLINE_ROUTE])");
    expect(source).not.toContain("'/m/elder/home'");
  });

  it('makes protected portal and API requests network-only', () => {
    expect(source).toContain('isProtectedRequest');
    expect(source).toContain("requestUrl.pathname.startsWith('/m/')");
    expect(source).toContain("requestUrl.pathname.startsWith('/auth/')");
    expect(source).toContain('event.respondWith(networkOnly(event.request))');
  });

  it('runtime-caches only same-origin static assets', () => {
    expect(source).toContain('requestUrl.origin === self.location.origin');
    expect(source).toContain('CACHEABLE_DESTINATIONS.has(request.destination)');
    expect(source).toContain("requestUrl.pathname.startsWith('/_next/static/')");
    expect(source).toContain('cacheFirstStaticAsset');
  });

  it('supports explicit cleanup after logout or principal change', () => {
    expect(source).toContain("event.data?.type === 'CLEAR_PRIVATE_DATA'");
    expect(source).toContain('caches.delete(STATIC_CACHE)');
  });
});

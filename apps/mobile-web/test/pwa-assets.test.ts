import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import createManifest from '../app/manifest';

describe('mobile PWA metadata', () => {
  it('declares installable 192px and 512px PNG icons', () => {
    const manifest = createManifest();

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

  it('uses versioned shell and runtime caches', () => {
    expect(source).toContain("const CACHE_VERSION = 'v2'");
    expect(source).toContain('SHELL_CACHE');
    expect(source).toContain('RUNTIME_CACHE');
  });

  it('uses network-first navigation with an offline fallback', () => {
    expect(source).toContain('networkFirstNavigation');
    expect(source).toContain("caches.match('/offline')");
    expect(source).toContain("event.request.mode === 'navigate'");
  });

  it('runtime-caches same-origin static assets', () => {
    expect(source).toContain('requestUrl.origin === self.location.origin');
    expect(source).toContain('CACHEABLE_DESTINATIONS.has(request.destination)');
    expect(source).toContain("requestUrl.pathname.startsWith('/_next/static/')");
    expect(source).toContain('cacheFirstAsset');
  });
});

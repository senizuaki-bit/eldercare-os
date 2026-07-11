import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: '#f3f7f6',
    description: '老人、护工与家属移动端的本地虚构演示壳',
    display: 'standalone',
    icons: [
      {
        purpose: 'any',
        sizes: '192x192',
        src: '/icons/icon-192.png',
        type: 'image/png'
      },
      {
        purpose: 'any',
        sizes: '512x512',
        src: '/icons/icon-512.png',
        type: 'image/png'
      }
    ],
    lang: 'zh-CN',
    name: '安心照护演示',
    orientation: 'portrait',
    scope: '/',
    short_name: '照护演示',
    start_url: '/m/elder/home',
    theme_color: '#0d665c'
  };
}

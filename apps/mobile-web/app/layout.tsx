import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { ServiceWorkerRegistration } from '../components/service-worker-registration';
import '@eldercare/ui/styles.css';
import './globals.css';

export const metadata: Metadata = {
  applicationName: '安心照护演示',
  description: '老人、护工与家属移动端的本地虚构演示壳',
  title: {
    default: '安心照护演示',
    template: '%s · 安心照护演示'
  }
};

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#0d665c',
  width: 'device-width'
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}

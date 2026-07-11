import '@eldercare/ui/styles.css';
import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppProviders } from './providers';

export const metadata: Metadata = {
  title: '照护运营台',
  description: '养老机构照护运营系统管理端（M00 本地演示壳）'
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}

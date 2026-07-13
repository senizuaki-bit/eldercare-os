import '@eldercare/ui/styles.css';
import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppProviders } from './providers';

export const metadata: Metadata = {
  title: '照护运营台',
  description: '具备安全会话、机构院区范围与角色权限的养老机构照护运营管理端'
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

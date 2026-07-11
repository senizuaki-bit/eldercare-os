'use client';

import { App, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import type { ReactNode } from 'react';

export function AppProviders({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#0b6b78',
          colorInfo: '#2563eb',
          colorSuccess: '#16865a',
          colorWarning: '#b76a00',
          colorError: '#d9363e',
          colorText: '#182432',
          colorTextSecondary: '#586779',
          colorBgLayout: '#f4f7fa',
          colorBorder: '#dce3ea',
          borderRadius: 10,
          controlHeight: 44,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
          fontSize: 14
        },
        components: {
          Button: {
            controlHeight: 44,
            fontWeight: 600
          },
          Card: {
            borderRadiusLG: 12
          },
          Table: {
            headerBg: '#f8fafc',
            headerColor: '#4b5c70',
            headerSplitColor: '#dce3ea',
            rowHoverBg: '#f7fbfc'
          }
        }
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
  );
}

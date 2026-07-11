import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@eldercare/ui'],
  turbopack: {
    root: path.resolve(import.meta.dirname, '../..')
  },
  experimental: {
    optimizePackageImports: ['antd', '@ant-design/icons']
  }
};

export default nextConfig;

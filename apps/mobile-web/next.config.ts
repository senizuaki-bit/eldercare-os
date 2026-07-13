import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@eldercare/contracts', '@eldercare/ui'],
  turbopack: {
    root: path.resolve(import.meta.dirname, '../..')
  },
  experimental: {
    optimizePackageImports: ['@ant-design/icons']
  }
};

export default nextConfig;

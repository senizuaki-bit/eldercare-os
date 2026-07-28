import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:3001',
    trace: 'on-first-retry',
    viewport: { width: 375, height: 812 }
  },
  webServer: [
    {
      command: 'corepack pnpm --filter @eldercare/api start',
      url: 'http://127.0.0.1:4000/health/live',
      reuseExistingServer: false,
      env: {
        AUTH_RATE_LIMIT_MAX_ATTEMPTS: '100',
        AUTH_RATE_LIMIT_KEY_PREFIX: `eldercare:offline-e2e:${Date.now()}`,
        CORS_ORIGINS: 'http://127.0.0.1:3001'
      },
      timeout: 120_000
    },
    {
      command: 'corepack pnpm --filter @eldercare/mobile-web start',
      url: 'http://127.0.0.1:3001',
      reuseExistingServer: false,
      timeout: 120_000
    }
  ],
  projects: [
    {
      name: 'mobile-production-offline',
      testMatch: /mobile-offline\.spec\.ts/
    }
  ]
});

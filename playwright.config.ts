import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  webServer: [
    {
      command: 'corepack pnpm --filter @eldercare/api exec tsx src/main.ts',
      url: 'http://127.0.0.1:4000/health/live',
      reuseExistingServer: false,
      env: {
        AUTH_RATE_LIMIT_MAX_ATTEMPTS: '100',
        AUTH_RATE_LIMIT_KEY_PREFIX: `eldercare:e2e:${Date.now()}`,
        CORS_ORIGINS: 'http://127.0.0.1:3300,http://127.0.0.1:3001'
      },
      timeout: 120_000
    },
    {
      command: 'corepack pnpm --filter @eldercare/admin-web exec next dev --hostname 127.0.0.1 --port 3300',
      url: 'http://127.0.0.1:3300',
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command: 'corepack pnpm --filter @eldercare/mobile-web dev',
      url: 'http://127.0.0.1:3001',
      reuseExistingServer: false,
      timeout: 120_000
    }
  ],
  projects: [
    {
      name: 'admin-1440',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:3300', viewport: { width: 1440, height: 900 } },
      testMatch: /admin-shell\.spec\.ts/
    },
    {
      name: 'admin-1280',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:3300', viewport: { width: 1280, height: 900 } },
      testMatch: /admin-shell\.spec\.ts/
    },
    {
      name: 'mobile-375',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:3001', viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
      testMatch: /mobile-shell\.spec\.ts/
    },
    {
      name: 'mobile-360',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:3001', viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true },
      testMatch: /mobile-shell\.spec\.ts/
    }
  ]
});

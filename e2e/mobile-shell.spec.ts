import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const DEMO_PASSWORD = 'LocalDemoOnly!2026';

async function login(page: Page, loginName: string) {
  await page.goto('/login');
  await page.getByLabel('账号').fill(loginName);
  await page.getByLabel('密码').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: '安全登录' }).click();
}

test('elder portal comes only from the server session and keeps critical actions accessible', async ({ page }) => {
  await login(page, 'elder.demo');
  await expect(page).toHaveURL(/\/m\/elder\/home$/);
  await expect(page.getByText('AI 关怀助手（演示）')).toBeVisible();

  const voiceAction = page.getByRole('button', { name: /点击说需求/ });
  const emergencyAction = page.getByRole('button', { name: /紧急求助/ });
  await expect(voiceAction).toBeVisible();
  await expect(emergencyAction).toBeVisible();
  const [voiceBox, emergencyBox] = await Promise.all([voiceAction.boundingBox(), emergencyAction.boundingBox()]);
  expect(voiceBox?.height ?? 0).toBeGreaterThanOrEqual(56);
  expect(emergencyBox?.height ?? 0).toBeGreaterThanOrEqual(56);

  await page.goto('/m/family/home');
  await expect(page.getByRole('heading', { name: '您无权查看此门户' })).toBeVisible();
  await expect(page.getByText('家属端首页')).toHaveCount(0);
  await expect(page.getByText(/原始录音|完整对话|护工实时位置/)).toHaveCount(0);

  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);
});

test('family portal shows the privacy-filtered summary and never a caregiver live location', async ({ page }) => {
  await login(page, 'family.demo');
  await expect(page).toHaveURL(/\/m\/family\/home$/);
  await expect(page.getByText('家属端首页')).toBeVisible();
  await expect(page.getByLabel('家属隐私说明')).toContainText('已隐藏原始录音、完整对话、内部备注和护工实时位置');
  await expect(page.getByText(/护工当前位置|经度|纬度/)).toHaveCount(0);

  const accountButton = page.getByRole('button', { name: /家属/ }).first();
  await accountButton.click();
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/m/family/home');
  await expect(page).toHaveURL(/\/login$/);
});

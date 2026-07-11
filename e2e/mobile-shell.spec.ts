import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('elder shell keeps the primary action large and explicit', async ({ page }) => {
  await page.goto('/m/elder/home');

  await expect(page.getByText('本地虚构演示 · 角色切换不代表真实授权')).toBeVisible();
  await expect(page.getByText('AI 关怀助手（演示）')).toBeVisible();

  const voiceAction = page.getByRole('button', { name: /点击说需求/ });
  const emergencyAction = page.getByRole('button', { name: /紧急求助/ });
  await expect(voiceAction).toBeVisible();
  await expect(emergencyAction).toBeVisible();

  const [voiceBox, emergencyBox] = await Promise.all([voiceAction.boundingBox(), emergencyAction.boundingBox()]);
  expect(voiceBox?.height ?? 0).toBeGreaterThanOrEqual(56);
  expect(emergencyBox?.height ?? 0).toBeGreaterThanOrEqual(56);

  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(horizontalOverflow).toBeLessThanOrEqual(1);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);
});

test('local role selector changes only the visible shell', async ({ page }) => {
  await page.goto('/m/elder/home');

  await page.getByRole('button', { name: /演示角色：老人端/ }).click();
  await page.getByRole('button', { name: '切换到家属端' }).click();

  await expect(page.getByText('家属端首页')).toBeVisible();
  await expect(page.getByLabel('家属隐私说明')).toContainText('已隐藏原始录音、完整对话、内部备注和护工实时位置');
  await expect(page.getByText(/护工当前位置|经度|纬度/)).toHaveCount(0);

  await page.getByRole('button', { name: /演示角色：家属端/ }).click();
  await page.getByRole('button', { name: '演示离线状态' }).click();
  await expect(page.getByRole('heading', { name: '网络已断开' })).toBeVisible();
  await expect(page.getByText(/不会标记为真实完成/)).toBeVisible();
});

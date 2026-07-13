import { expect, test } from '@playwright/test';

test('production PWA never restores a protected portal from an offline cache', async ({ context, page }) => {
  await page.goto('/login');
  await page.getByLabel('账号').fill('elder.demo');
  await page.getByLabel('密码').fill('LocalDemoOnly!2026');
  await page.getByRole('button', { name: '安全登录' }).click();
  await expect(page).toHaveURL(/\/m\/elder\/home$/);
  await expect(page.getByText('AI 关怀助手（演示）')).toBeVisible();
  await page.evaluate(async () => navigator.serviceWorker.ready);

  await context.setOffline(true);
  const response = await page.reload();
  expect(response?.status()).toBe(503);
  await expect(page.getByText(/受保护内容不会从缓存中恢复/)).toBeVisible();
  await expect(page.getByText('AI 关怀助手（演示）')).toHaveCount(0);

  await page.goto('/not-cached-during-install');
  await expect(page.getByRole('heading', { name: '暂时无法连接' })).toBeVisible();
});

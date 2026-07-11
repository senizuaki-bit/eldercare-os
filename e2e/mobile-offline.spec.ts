import { expect, test } from '@playwright/test';

test('production PWA keeps a cached elder shell and offline fallback available', async ({ context, page }) => {
  await page.goto('/m/elder/home');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.getByText('AI 关怀助手（演示）')).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('AI 关怀助手（演示）')).toBeVisible();

  await page.goto('/not-cached-during-install');
  await expect(page.getByRole('heading', { name: '暂时无法连接' })).toBeVisible();
});

import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('risk-first admin shell renders without viewport overflow', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: '风险与待办', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: '优先处理队列' })).toBeVisible();
  await expect(page.getByText('未确认紧急事件').first()).toBeVisible();
  await expect(page.getByText('待人工复核').first()).toBeVisible();
  await expect(page.getByText('超时工单').first()).toBeVisible();
  await expect(page.getByText('关键设备离线').first()).toBeVisible();

  const viewportOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(viewportOverflow).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: '折叠侧栏' }).click();
  await expect(page.getByRole('button', { name: '展开侧栏' })).toBeVisible();

  const search = page.getByRole('searchbox', { name: '全局搜索演示队列' });
  await search.fill('关键设备');
  await expect(page.getByText('关键设备离线').first()).toBeVisible();
  await expect(page.getByText('未确认紧急事件')).toHaveCount(0);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);
});

test('admin shell exposes honest degraded and stale states', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('combobox', { name: '演示页面状态' }).click();
  await page.getByText('离线状态', { exact: true }).click();
  await expect(page.getByText('当前处于离线模式')).toBeVisible();
  await expect(page.getByText(/不会把缓存内容标记为实时数据/)).toBeVisible();

  await page.getByRole('combobox', { name: '演示页面状态' }).click();
  await page.getByText('数据已过期', { exact: true }).click();
  await expect(page.getByRole('status')).toContainText('最后成功同步于今天 10:42');
});

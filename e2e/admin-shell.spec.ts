import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const DEMO_PASSWORD = 'LocalDemoOnly!2026';

async function login(page: Page, next = '/users') {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('账号').fill('facility.director');
  await page.getByLabel('密码').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace('/', '\\/')}$`));
}

test('authenticated user directory is scoped, searchable and accessible', async ({ page }) => {
  await login(page);

  await expect(page.getByRole('heading', { name: '用户与访问范围', level: 1 })).toBeVisible();
  await expect(page.getByRole('status', { name: '当前访问范围' })).toContainText('青岚');
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByText('facility.director')).toBeVisible();
  await expect(page.getByText('platform.admin')).toHaveCount(0);

  const search = page.getByRole('searchbox', { name: '搜索当前页面' });
  await search.fill('nursing.supervisor');
  await expect(page.getByText('nursing.supervisor')).toBeVisible();
  await expect(page.getByText('facility.director')).toHaveCount(0);

  const viewportOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(viewportOverflow).toBeLessThanOrEqual(1);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);
});

test('roles stay read-first and logout invalidates the protected route', async ({ page }) => {
  await login(page, '/roles');

  await expect(page.getByRole('heading', { name: '角色与权限', level: 1 })).toBeVisible();
  await expect(page.getByText('只读 MVP')).toBeVisible();
  await expect(page.getByText('NURSING_SUPERVISOR')).toBeVisible();
  await page.getByRole('searchbox', { name: '搜索当前页面' }).fill('FACILITY_DIRECTOR');
  await expect(page.getByText('FACILITY_DIRECTOR')).toBeVisible();

  await page.getByRole('button', { name: '打开个人菜单' }).click();
  await page.getByText('安全退出').click();
  await expect(page).toHaveURL(/\/login\?reason=logout$/);
  await page.goto('/users');
  await expect(page).toHaveURL(/\/login\?reason=required$/);
  await expect(page.getByText('请先登录后继续访问管理端。')).toBeVisible();
});

test('M02 operational directories expose scoped elder, room, staff and shift context', async ({ page }) => {
  await login(page, '/elders');

  await expect(page.getByRole('heading', { name: '老人档案', level: 1 })).toBeVisible();
  await expect(page.getByText('长者01', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '快速详情' }).first().click();
  const detailDrawer = page.getByRole('dialog');
  await expect(detailDrawer.getByRole('heading', { name: /长者01 · 快速详情/ })).toBeVisible();
  await expect(detailDrawer.getByText('快速详情只展示必要摘要')).toBeVisible();
  await expect(detailDrawer.getByText('当前房间床位', { exact: true })).toBeVisible();

  await page.goto('/facility/rooms');
  await expect(page.getByRole('heading', { name: '房间床位', level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: '房间床位目录' })).toBeVisible();
  await expect(page.getByText(/个可用床位/).first()).toBeVisible();
  await expect(page.getByText(/虚构长者/)).toHaveCount(0);

  await page.goto('/staff');
  await expect(page.getByRole('heading', { name: '员工目录', level: 1 })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByText('虚构护工01')).toBeVisible();

  await page.goto('/shifts');
  await expect(page.getByRole('heading', { name: '周排班', level: 1 })).toBeVisible();
  await expect(page.getByLabel('可横向滚动的周排班表')).toBeVisible();

  const viewportOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(viewportOverflow).toBeLessThanOrEqual(1);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);
});

test('M03 need and work-order queues expose the auditable care workflow', async ({ page }) => {
  await login(page, '/needs');

  await expect(page.getByRole('heading', { name: '需求复核队列', level: 1 })).toBeVisible();
  await expect(page.getByText('AI 只提供草案')).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByText('老人语音请求').first()).toBeVisible();

  await page.goto('/work-orders');
  await expect(page.getByRole('heading', { name: '工单管理', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: /院区工单/, level: 2 })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
  await page.getByRole('link', { name: /详情/ }).first().click();

  await expect(page).toHaveURL(/\/work-orders\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: 'AI 建议（非最终决定）', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: '确定性风险规则', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: '不可变状态时间线', level: 2 })).toBeVisible();
  await expect(page.locator('audio')).toHaveCount(0);
  await expect(page.getByText('我想喝热水，今天有点头晕。', { exact: true })).toHaveCount(0);

  const viewportOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(viewportOverflow).toBeLessThanOrEqual(1);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);
});

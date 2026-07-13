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
  await expect(page.getByText('device.manager')).toHaveCount(0);

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

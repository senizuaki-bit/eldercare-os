import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const DEMO_PASSWORD = 'LocalDemoOnly!2026';

async function login(page: Page) {
  await page.goto('/login?next=%2Femergencies');
  await page.getByLabel('账号').fill('facility.director');
  await page.getByLabel('密码').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL(/\/emergencies$/);
}

test('M04 critical queue leads to an auditable emergency command center', async ({
  page
}) => {
  await login(page);

  await expect(
    page.getByRole('heading', { name: '紧急事件', level: 1 })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '当前紧急响应队列', level: 2 })
  ).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.locator('.m04-status-stack').first()).toBeVisible();
  await expect(page.locator('.m04-location-stack').first()).toBeVisible();
  await expect(page.locator('.m04-sla-timer').first()).toBeVisible();

  const commandLink = page.getByRole('link', { name: /进入指挥/ }).first();
  await expect(commandLink).toBeVisible();
  await commandLink.click();

  await expect(page).toHaveURL(/\/emergencies\/[0-9a-f-]+$/);
  await expect(
    page.getByRole('heading', { name: '紧急响应指挥', level: 1 })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '位置与人工确认路径', level: 2 })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '响应时间线', level: 2 })
  ).toBeVisible();
  await expect(
    page.getByText('紧急状态只能由有权限的人工作出决定')
  ).toBeVisible();
  await expect(
    page.getByText(/护工实时位置|家属可查看精确位置/)
  ).toHaveCount(0);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((violation) =>
      ['critical', 'serious'].includes(violation.impact ?? '')
    )
  ).toEqual([]);
});

import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const DEMO_PASSWORD = 'LocalDemoOnly!2026';

async function login(page: Page, loginName: string) {
  await page.goto('/login');
  await page.getByLabel('账号').fill(loginName);
  await page.getByLabel('密码').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: '安全登录' }).click();
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test('elder emergency entry stays pending until the server confirms it', async ({
  page
}) => {
  await login(page, 'elder.demo');
  await expect(page).toHaveURL(/\/m\/elder\/home$/);

  const emergency = page.getByRole('button', { name: /紧急求助/ });
  await expect(emergency).toBeEnabled();
  expect((await emergency.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(56);
  const creationResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/elder/emergencies'
  );
  await emergency.click();
  const creationResponse = await creationResponsePromise;
  expect(
    creationResponse.status(),
    await creationResponse.text()
  ).toBe(200);

  await expect(page).toHaveURL(/\/m\/elder\/emergency\/[0-9a-f-]+$/);
  await expect(
    page.getByRole('heading', { name: '求助已经登记' })
  ).toBeVisible();
  await expect(page.getByText('服务器已确认')).toBeVisible();
  await expect(page.getByRole('link', { name: /拨打/ })).toHaveAttribute(
    'href',
    /^tel:/
  );
  await expect(
    page.getByText(/页面显示已登记而停止寻求现场帮助/)
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('caregiver home puts emergency response before routine work', async ({
  page
}) => {
  await login(page, 'caregiver.demo');
  await expect(page).toHaveURL(/\/m\/caregiver\/home$/);

  const emergencyPanel = page.getByRole('heading', {
    name: '当前紧急任务',
    level: 2
  });
  const routinePanel = page.getByRole('heading', {
    name: '优先任务',
    level: 2
  });
  await expect(emergencyPanel).toBeVisible();
  await expect(routinePanel).toBeVisible();
  const [emergencyBox, routineBox] = await Promise.all([
    emergencyPanel.boundingBox(),
    routinePanel.boundingBox()
  ]);
  expect(emergencyBox?.y ?? Number.MAX_SAFE_INTEGER).toBeLessThan(
    routineBox?.y ?? 0
  );

  await page.getByRole('button', { name: /查看紧急事件/ }).first().click();
  await expect(page).toHaveURL(/\/m\/caregiver\/emergencies\/[0-9a-f-]+$/);
  await expect(
    page.getByRole('heading', { name: '紧急任务详情', level: 1 })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '响应步骤', level: 2 })
  ).toBeVisible();
  await expect(page.getByRole('link', { name: '呼叫 120' })).toHaveAttribute(
    'href',
    'tel:120'
  );
  await expectNoHorizontalOverflow(page);
});

test('family sees only published safe stages and an elder-scoped preference', async ({
  page
}) => {
  await login(page, 'family.demo');
  await expect(page).toHaveURL(/\/m\/family\/home$/);

  await expect(
    page.getByRole('heading', { name: '紧急事件摘要', level: 2 })
  ).toBeVisible();
  await expect(
    page.getByText(/只显示机构发布的必要阶段摘要/)
  ).toBeVisible();
  await expect(page.getByText(/当前设置：/)).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: '接收紧急事件通知' })
  ).toBeVisible();
  await expect(
    page
      .locator('.family-emergency-list')
      .getByText(/精确坐标|护工当前位置|内部清单|完整转写/)
  ).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((violation) =>
      ['critical', 'serious'].includes(violation.impact ?? '')
    )
  ).toEqual([]);
});

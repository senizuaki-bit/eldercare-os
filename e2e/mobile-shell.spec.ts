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
  await expect(page.getByText('AI 关怀助手', { exact: true })).toBeVisible();

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

test('elder voice request discloses AI, preserves human exit and shows only server-confirmed results', async ({ page }) => {
  await login(page, 'elder.demo');
  await page.getByRole('button', { name: /点击说需求/ }).click();

  await expect(page).toHaveURL(/\/m\/elder\/voice-request$/);
  await expect(page.getByRole('heading', { name: '说出您的需要', level: 1 })).toBeVisible();
  await expect(page.getByLabel('AI 身份说明')).toContainText('AI 只整理需求草稿');
  await expect(page.getByLabel('演示语句')).toContainText('我想喝热水，今天有点头晕');
  await expect(page.getByRole('button', { name: '联系工作人员' })).toBeVisible();

  await page.getByRole('button', { name: /提交演示语句/ }).click();
  await expect(page.getByRole('heading', { name: /工作人员正在复核|需求已经成功登记|需求草稿已经生成/ })).toBeVisible();
  await expect(page.getByLabel('服务器生成的需求摘要')).toContainText('需要人工复核');
  await expect(page.getByRole('region', { name: /工作人员正在复核|需求已经成功登记|需求草稿已经生成/ }))
    .toContainText('AI 没有作出医疗或紧急决定');

  const voiceButton = page.getByRole('button', { name: /结束本次交流/ });
  expect((await voiceButton.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);
});

test('family portal shows the privacy-filtered summary and never a caregiver live location', async ({ page }) => {
  await login(page, 'family.demo');
  await expect(page).toHaveURL(/\/m\/family\/home$/);
  await expect(page.getByText('家属端首页')).toBeVisible();
  await expect(page.getByRole('region', { name: '按关系和同意授权的老人档案' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '长者01', level: 3 })).toBeVisible();
  await expect(page.getByText('已共享 3 类字段')).toBeVisible();
  await expect(page.getByLabel('家属隐私说明')).toContainText('原始音频、完整转写、内部备注和护工实时位置不会出现在这里');
  await expect(page.getByRole('heading', { name: '已发布照护摘要', level: 2 })).toBeVisible();
  await expect(page.getByText('饮水服务已完成')).toBeVisible();
  await expect(page.getByText(/护工当前位置|经度|纬度/)).toHaveCount(0);

  const accountButton = page.getByRole('button', { name: /家属/ }).first();
  await accountButton.click();
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/m/family/home');
  await expect(page).toHaveURL(/\/login$/);
});

test('caregiver portal limits elder context to the current effective shift', async ({ page }) => {
  await login(page, 'caregiver.demo');
  await expect(page).toHaveURL(/\/m\/caregiver\/home$/);
  await expect(page.getByRole('region', { name: '当前有效班次内的老人档案' })).toBeVisible();
  await expect(page.getByText('当前班次授权').first()).toBeVisible();
  await expect(page.getByText('仅在有效班次内可见').first()).toBeVisible();
  await expect(page.getByText(/家属关系|同意记录|原始音频|完整对话/)).toHaveCount(0);

  await page.getByRole('button', { name: /查看任务：/ }).first().click();
  await expect(page).toHaveURL(/\/m\/caregiver\/tasks\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: '任务详情', level: 1 })).toBeVisible();
  await expect(page.getByText('完成任务所需注意事项')).toHaveCount(0);
  await expect(page.getByText('常规')).toBeVisible();
  await expect(page.getByRole('button', { name: /确认到场|开始处理|提交文字完成记录/ })).toBeVisible();
  await expect(page.getByText(/家属关系|同意记录|原始音频|完整转写/)).toHaveCount(0);

  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);
});

# 养老照护运营与智能体平台：Codex 启动说明

项目代号：`eldercare-os`

## 1. 产品目标

交付一个可本地运行、可演示、可继续扩展的养老机构平台：

- 管理后台
- 老人端、护工端、家属端移动 PWA
- 机构、楼栋、楼层、房间、床位、老人、家属、护工和排班
- 老人语音需求 → AI 草稿分析 → 风险规则 → 工单 → 护工处置 → 家属安全摘要 → 评价 → 报表
- 紧急事件、定位、派发、超时升级、处置和复盘
- 设备心跳、离线告警、维修和替代巡查
- 情绪趋势观察、家属沟通助手和运营 AI
- 新闻/公告/内容播报和偏好
- 兴趣、活动推荐、报名、签到、护送和反馈
- 服务目录、服务包、推荐、订单、Fake Payment、履约、退款和评价
- 多智能体注册、受限工具、审批门、审计和统一编排

完整端到端模型见：

- `docs/11-END-TO-END-FLOWS.md`
- `docs/12-CONTENT-ACTIVITY-COMMERCE.md`
- `docs/13-MULTI-AGENT-ORCHESTRATION.md`
- `docs/14-EVENT-CATALOG.md`
- `docs/15-END-TO-END-ACCEPTANCE.md`

## 2. 分阶段范围

### M00–M11：照护底座

- 身份、权限、老人档案和入住
- 语音需求与工单
- 紧急事件
- IoT 设备离线
- 室内地图与位置时效
- AI 需求、情绪观察和家属沟通草稿
- 老人/护工/家属移动端
- 报表、评价、绩效
- 安全隐私与核心发布演示

### M12–M16：平台扩展与全链路集成

- M12 内容与新闻
- M13 兴趣与活动
- M14 服务、套餐、订单和 Fake Payment
- M15 多智能体编排和审批
- M16 全端到端事件、时间线、测试与平台发布

先完成并稳定 M00–M11，再开发 M12–M16。不要在一个 PR 中跨多个里程碑。

### 当前实现进度

- M00–M03 已完成；M02 通过 [GitHub PR #1](https://github.com/senizuaki-bit/eldercare-os/pull/1) 合并，M03 通过 [GitHub PR #2](https://github.com/senizuaki-bit/eldercare-os/pull/2) 合并。
- `codex/m04-emergency` 已完成紧急信号、确定性风险与 SLA、指派、护工响应、位置时效、升级、处置、主管复盘、家属隐私摘要、MQTT 模拟和留存清理，并通过完整门禁。
- M04 当前为 `READY_FOR_REVIEW`；M05 设备心跳丢失、离线告警、维修任务和替代巡查仍未开始。

里程碑的实时状态、已运行证据和已知限制以 `docs/TASK_STATUS.md` 为准。

## 3. 首版明确不做

- 医疗诊断、处方、自动停药、自动急救决策
- 真实生产硬件；使用 MQTT 模拟器和适配器
- 厘米级 UWB；先做到楼栋/楼层/房间/区域级
- 未经审核让 AI 直接说服老人
- 公开末位排行榜或自动处罚
- 真实身份证、病历、录音、定位和支付信息作为演示数据
- 真实支付、真实新闻抓取或生产密钥
- 无审核、无限推流的电商信息流
- 仅靠前端隐藏实现权限

## 4. 技术基线

- Monorepo：pnpm workspace + Turborepo
- 语言：TypeScript
- 管理端：Next.js + Ant Design + ECharts
- 移动端：Next.js PWA
- API：NestJS + REST + OpenAPI + SSE（后续按实时场景需要引入 WebSocket）
- 数据库：PostgreSQL + Prisma
- 队列：Redis + BullMQ
- 文件：S3 兼容；本地 MinIO
- IoT：MQTT；本地 Mosquitto
- 事件：事务 Outbox + 幂等消费者 + Dead Letter
- AI：供应商无关适配器 + deterministic fake providers
- 支付：FakePaymentProvider
- 测试：Vitest/Jest、API 集成、Playwright E2E
- 基础设施：Docker Compose

Codex 应选择当前稳定版本并锁定在 lockfile，不随意换栈。

## 5. 视觉参考

参考图位于 `docs/references/`，仅用于提炼：

- 管理端浅色、左侧导航、卡片化工作台和高密度表格
- 移动端白底、青绿点缀、大按钮、地图和任务卡片

禁止复制品牌、Logo、头像、水印、原文案和精确布局。详细要求见 `docs/01-UX-REFERENCE-SPEC.md`。

## 6. 执行顺序

1. 将整个启动包放入空 Git 仓库根目录。
2. 启动 Codex，让它先只读并总结全部文档。
3. 依次执行 `prompts/00` 到 `prompts/16`。
4. 每阶段单独分支、单独 PR、单独验收。
5. 每阶段先输出文件级计划，再等待批准。
6. 每阶段完成后更新 `docs/TASK_STATUS.md`。
7. 合并前人工检查 diff、迁移、权限、同意、审批、幂等、敏感日志和演示路径。

推荐分支：

```text
feat/m00-foundation
feat/m01-auth-rbac
feat/m02-elder-management
feat/m03-needs-workorders
feat/m04-emergency
feat/m05-iot-offline
feat/m06-indoor-map
feat/m07-ai-pipeline
feat/m08-mobile-portals
feat/m09-reports-performance
feat/m10-security-compliance
feat/m11-release-demo
feat/m12-content-news
feat/m13-activities-interests
feat/m14-services-commerce
feat/m15-agent-orchestration
feat/m16-end-to-end-integration
```

## 7. 每阶段固定检查

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

涉及用户流程：

```bash
pnpm test:e2e
```

本地启动目标：

```bash
cp .env.example .env
pnpm install
docker compose up -d
corepack pnpm storage:init
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`corepack pnpm storage:init` 必须在 Compose 服务启动后执行；它会幂等创建本地私有 MinIO bucket、关闭匿名访问，并为 `voice/staging/` 配置 1 天过期的生命周期兜底规则。

## 8. 核心演示链路（M00–M11）

1. 院长看到风险、待办、设备和服务概览。
2. 管理员查看楼栋、房间、床位、老人和护工。
3. 老人说：“我想喝热水，今天有点头晕。”
4. Fake AI 转写、总结、分类；规则要求人工复核。
5. 护工接单、定位到房间、到场并语音完成。
6. 家属收到隐私过滤摘要。
7. 老人评价，报表更新。
8. 关键设备离线产生维修和替代巡查。
9. 紧急按钮完成派发、升级、处置和复盘。
10. 权限、同意、位置时效和审计均有失败测试。

## 9. 完整平台演示（M12–M16）

在核心演示之上：

- 审核新闻并向老人播报，老人更新偏好。
- 按兴趣推荐活动、报名、生成护送工单、签到和评价。
- 老人主动选择助浴服务包，家属代付，Fake Payment 成功，生成履约任务，完成和退款。
- 多意图“头晕 + 活动 + 购买”由编排器优先处理健康风险，暂缓商业动作。
- 全部事件进入老人 360 时间线、家属摘要、报表和审计。

以 `docs/15-END-TO-END-ACCEPTANCE.md` A–J 旅程全部通过为最终完成标准。

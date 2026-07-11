# 03 — 技术架构

## 1. 逻辑架构

```text
Admin Web / Mobile PWA / Optional Provider Portal
                    |
             API Gateway / NestJS API
                    |
  +-----------------+------------------+------------------+
  |                 |                  |                  |
PostgreSQL       Redis/BullMQ       MinIO/S3          WebSocket/SSE
(system record)  jobs/SLA/cache     audio/files       realtime updates
  |
Transactional Outbox -> Domain Event Bus -> Idempotent Consumers
  |                       |              |              |
  |                    AI Worker     Notification    Reporting/Search
  |                       |
  |                 Agent Orchestrator
  |                       |
  |                 Restricted Tool Gateway
  |
MQTT Broker <-> IoT Ingestion <-> Device/Location Services

External adapters:
- AI transcription / structured analysis / TTS
- approved content/news sources
- email/SMS/push/voice notification
- fake or real payment provider
- approved service providers
```

## 2. 应用与包布局

```text
apps/
  admin-web/          institution console
  mobile-web/         elder/caregiver/family role PWA
  provider-web/       optional later supplier portal
  api/                REST/OpenAPI/WebSocket API
  worker/             queues, SLA, AI, event consumers, reporting
  iot-simulator/      MQTT heartbeat/location/emergency fixtures
packages/
  db/                 Prisma schema, migrations, seed
  contracts/          API/event/AI/payment schemas and generated clients
  ui/                 shared components and design tokens
  authz/              permissions, scopes, relationships, approvals
  ai/                 provider-neutral AI adapters
  agents/             registry, router, policies, tool contracts
  events/             outbox, event envelope, consumers
  content/            source adapters and content policy helpers
  commerce/           catalog, pricing, order/payment abstractions
  config/             typed configuration
  observability/      logs, metrics, tracing, redaction
infra/
  docker/
docs/
```

`provider-web` 可在 M14 只保留包/路由预留，不要求独立部署。

## 3. 领域模块边界

### 核心照护

- Identity/Auth
- Organization/Facility
- Elder/Relationships/Consent
- Staff/Teams/Shifts
- Needs/WorkOrders
- Emergencies
- Devices/Alerts
- Location/FloorPlans
- AI Observations/Family Communication
- Ratings/Performance

### 扩展平台

- Content/News/Playback/Preferences
- Interests/Activities/Enrollment/Attendance
- Service Catalog/Packages/Entitlements
- Recommendations/Checkout/Orders/Payments/Refunds
- Fulfillment/Providers
- Agent Registry/Router/Tools/Approvals/Runs
- Notifications
- Analytics/Reports
- Audit/Exports/Retention

模块不得直接更新其他模块表。跨模块由应用服务、受限工具或领域事件协作。

## 4. 系统记录源

- PostgreSQL：业务事实、状态机、同意、审计、支付状态。
- S3/MinIO：原始语音、附件和内容媒体；数据库只保存元数据。
- Redis：队列、短期缓存、幂等锁；不是业务事实源。
- 报表表/物化视图：可从事实或事件重建。
- 搜索索引（后续可选）：可重建，不保存超出权限的字段。

## 5. 同步与异步

### 同步

- 登录和授权
- CRUD 与关系校验
- 状态转换
- 活动报名容量校验
- 订单确认/结算意向
- 智能体工具权限与审批判断

### 异步

- 音频转写、AI 分析、TTS
- 通知、SLA 升级、设备离线检查
- 内容抓取/摘要/排期
- 活动提醒和护送任务
- 支付 webhook、退款和履约通知
- 报表聚合、保留期删除

所有异步任务需要：幂等键、重试、死信可见、correlationId、敏感字段脱敏和重放安全。

## 6. 事务 Outbox 与事件总线

业务状态和 outbox 事件在同一数据库事务提交。Worker 发布后标记状态；消费者按 `eventId` 幂等。

典型链路：

```text
WORK_ORDER.VERIFIED
-> family summary consumer
-> rating invitation consumer
-> analytics consumer
-> timeline consumer
```

事件目录见 `docs/14-EVENT-CATALOG.md`。

## 7. API 原则

- REST 资源化路由，OpenAPI 为可验证契约。
- 输入 DTO + schema 校验；所有 ID 重新做服务端范围检查。
- 列表统一分页、排序、过滤和字段白名单。
- 错误使用稳定错误码，不暴露堆栈和内部模型文本。
- 写操作携带 actor、correlationId、consent/approval context。
- 文件上传先申请受限 URL，完成后登记和扫描状态。
- 外部 webhook 使用签名、时间窗口、幂等键和重放保护。

## 8. 多智能体

智能体编排器只负责路由和计划，不直接连接数据库。工具网关：

1. 根据 actor、角色、老人关系和同意检查工具权限。
2. 根据工具风险等级决定自动、确认或人工审批。
3. 生成最小化工具输入。
4. 执行业务服务并返回最小化结构化结果。
5. 保存工具审计和最终业务对象。

不提供通用 SQL、任意网络、shell 或不受限文件工具给老人/家属交互智能体。

## 9. 内容与商业外部适配器

### ContentSourceProvider

负责拉取来源元数据和内容草稿。外部文本永远视为不可信，先审核入库，再供播报智能体使用。

### PaymentProvider

```ts
interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<PaymentResult>
  verifyWebhook(input: RawWebhook): Promise<VerifiedPaymentEvent>
  refund(input: RefundInput): Promise<RefundResult>
}
```

本地默认 `FakePaymentProvider`。真实支付不能把凭证交给模型或普通日志。

### NotificationProvider

邮件、短信、Push、电话分别使用适配器；通知失败不回滚业务事实。

## 10. 实时更新

可实时推送：护工任务、紧急事件、设备告警、活动容量、订单履约和审批待办。

- 推送只包含最小摘要和资源 ID。
- 订阅建立和每条消息均按组织、设施、角色和关系鉴权。
- 客户端收到后再请求详情。

## 11. 可观测性

- 结构化日志 + correlationId + actor type
- API/worker/MQTT/payment readiness
- 队列积压、死信、事件发布延迟
- AI 路由、工具拒绝、人工审批、成本和失败率
- 紧急 SLA、设备离线、活动到场、订单履约和退款
- 不记录原始转写、精确坐标、支付凭证或完整情绪/家庭沟通

## 12. 扩展和部署原则

首版为模块化单体 + 独立 Worker，优先保证事务和开发效率。只有出现明确吞吐/组织边界后，才将 MQTT ingestion、AI、content 或 commerce 拆成服务；不得为“微服务感”提前引入分布式复杂度。

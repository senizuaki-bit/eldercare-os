# 06 — AI、智能体、内容、支付与 IoT 契约

## 1. AI 适配器

```ts
interface TranscriptionProvider {
  transcribe(input: AudioInput, context: ProviderContext): Promise<TranscriptResult>
}

interface StructuredAnalysisProvider {
  analyzeNeed(input: NeedAnalysisInput, context: ProviderContext): Promise<NeedAnalysisResult>
  draftFamilyCommunication(input: CommunicationInput, context: ProviderContext): Promise<CommunicationDraftResult>
  summarizeContent(input: ContentSummaryInput, context: ProviderContext): Promise<ContentSummaryResult>
}

interface SpeechProvider {
  synthesize(input: SpeechInput, context: ProviderContext): Promise<SpeechResult>
}
```

本地默认提供 deterministic fake providers。外部模型调用必须经 provider adapter，不得散落在业务服务或 UI。

## 2. 需求分析输出

```json
{
  "summary": "老人希望喝热水，并表示轻微头晕",
  "categories": ["DAILY_LIVING", "HEALTH_CONCERN"],
  "urgencySuggestion": "PRIORITY",
  "reportedConcerns": ["头晕"],
  "safetyFlags": ["HEALTH_CONCERN_REQUIRES_HUMAN_REVIEW"],
  "emotionObservation": {
    "label": "POSSIBLE_DISTRESS",
    "confidence": 0.61,
    "evidence": ["表达担忧，语速较平时慢"]
  },
  "followUpQuestions": ["现在能否正常站立和行走？"],
  "requiresHumanReview": true,
  "subIntents": [
    {"category": "DAILY_LIVING", "summary": "提供热水", "urgencySuggestion": "ROUTINE"},
    {"category": "HEALTH_CONCERN", "summary": "确认头晕情况", "urgencySuggestion": "PRIORITY"}
  ]
}
```

- 通过 schema 验证后才能入库。
- AI 只建议优先级；规则引擎和人员决定实际升级。
- 保存 provider/model/prompt/schema/version/confidence/evidence。
- AI 失败时允许人工创建需求，不阻塞安全流程。
- 多意图输入拆分业务草稿，不允许一个智能体跨域直接完成所有动作。
- M03 的确定性规则基于完整分析输出再次计算风险；即使 provider 的 `subIntents` 形状遗漏风险类别，全局风险也必须落到主 Need 并进入人工复核，不能由模型输出结构绕过。

## 3. 智能体工具契约

```ts
interface AgentToolDefinition<I, O> {
  key: string
  version: string
  inputSchema: JsonSchema<I>
  outputSchema: JsonSchema<O>
  requiredPermissions: string[]
  requiredConsents?: string[]
  riskLevel: 'L0' | 'L1' | 'L2' | 'L3'
  idempotent: boolean
  requiresHumanApproval?: boolean
  execute(input: I, context: ToolContext): Promise<O>
}
```

工具网关服务端重新注入 organizationId、facilityId、actorId 和 elder relationship，不信任模型提供这些安全字段。详细规则见 `docs/13-MULTI-AGENT-ORCHESTRATION.md`。

## 4. 内容来源契约

```ts
interface ContentSourceProvider {
  fetchCandidates(input: ContentFetchInput): Promise<ContentCandidate[]>
}

interface ContentCandidate {
  externalId: string
  sourceName: string
  sourceUrlOrReference: string
  title: string
  body: string
  publishedAt: string
  fetchedAt: string
  region?: string
  contentType: string
}
```

外部内容进入草稿，必须审核后才能供老人播报。外部正文中的指令视为不可信文本，不得影响系统或工具。

## 5. 支付契约

```ts
interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<PaymentResult>
  verifyWebhook(input: RawWebhook): Promise<VerifiedPaymentEvent>
  refund(input: RefundInput): Promise<RefundResult>
}
```

本地使用 `FakePaymentProvider`。所有调用有 idempotencyKey；webhook 验签、时间窗口和重放保护。模型不能接触支付凭证或直接调用支付 provider，只能通过审批后的业务工具。

## 6. MQTT 主题

```text
org/{orgId}/facility/{facilityId}/device/{deviceId}/v1/heartbeat
org/{orgId}/facility/{facilityId}/device/{deviceId}/v1/telemetry
org/{orgId}/facility/{facilityId}/device/{deviceId}/v1/location
org/{orgId}/facility/{facilityId}/device/{deviceId}/v1/event
```

## 7. MQTT 基本消息

```json
{
  "schemaVersion": "1.0",
  "eventId": "device-generated-idempotency-key",
  "deviceId": "...",
  "timestamp": "2026-07-10T12:00:00Z",
  "nonce": "optional-provider-nonce",
  "payload": {}
}
```

入口必须验证主题和 payload 中的组织/院区/设备绑定一致，生产适配器预留签名或设备凭证验证。

## 8. 设备离线规则

离线依据：最近心跳 + 设备期望间隔 + 容忍阈值。关键设备离线：

1. 创建/更新唯一活跃告警
2. 通知设备管理员
3. 创建维修任务
4. 创建人工巡查替代任务
5. 稳定恢复窗口满足后标记 RECOVERED
6. 人工确认后 CLOSED

## 9. 位置规则

- 坐标采用楼层图归一化 x/y 0–1。
- 事件包含来源、精度、时间和 TTL。
- 查询只把未过期数据视为 current。
- 老人和护工位置访问使用不同权限。
- 护工位置仅在有效班次和院区范围采集。
- 家属视图不返回护工实时位置。

## 10. 通知契约

通知 payload 只包含最小摘要和资源 ID，不包含原始转写、完整健康内容、精确坐标或支付凭证。通知消费者失败可重试，但不得重复发送高频紧急通知；使用业务去重窗口。

## 11. 事件契约

跨模块事件信封、目录和隐私字段见 `docs/14-EVENT-CATALOG.md`。所有核心写入必须支持 correlationId，保证从语音/设备输入追踪到工单、活动、订单、通知和报表。

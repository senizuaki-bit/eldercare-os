# 10 — 测试策略

## 1. 单元测试

### 核心照护

- 状态机转换
- 风险规则
- 权限 policy、数据范围和关系
- 绩效公式
- 位置 TTL
- 设备离线/恢复窗口
- AI schema parser
- 隐私过滤

### 扩展平台

- 内容审核/撤回规则
- 活动容量、候补和时间冲突
- 推荐解释、频控和商业暂停
- 订单、支付、退款和权益状态机
- 价格/金额/币种校验
- Agent 路由、工具风险等级和审批门
- 外部内容 prompt injection 防护

## 2. 集成测试

使用真实 PostgreSQL/Redis（测试容器或 compose）：

- 登录、会话和 tenant scope
- CRUD + data scope + consent
- 工单/紧急/设备/活动/订单事务
- outbox、event bus、consumer inbox 和 dead letter
- MQTT ingestion
- Fake Payment webhook、验签模拟、幂等和退款
- 文件元数据和签名 URL 权限
- Agent tool gateway 调用业务服务
- 通知失败重试不回滚业务

## 3. E2E

Playwright 角色：院长、主管、护工、老人、家属、设备管理员、内容运营、活动运营、服务运营、供应商角色。

必须覆盖：

- `docs/09-DEMO-ACCEPTANCE.md` 主链路
- `docs/15-END-TO-END-ACCEPTANCE.md` A–J 旅程
- forbidden 页面和字段
- loading/empty/error/offline/stale/suppressed
- 移动视口和老人端大按钮
- 键盘导航的管理端核心路径
- 支付不确定状态、退款和活动取消

## 4. 契约测试

- OpenAPI 与客户端类型一致
- 领域事件 envelope 和版本
- MQTT payload schema
- AI structured output fixture
- Agent tool input/output schema
- ContentSourceProvider fixture
- PaymentProvider/webhook fixture
- notification payload 最小化

## 5. 幂等与并发

必须覆盖：

- 两个护工同时接单
- 重复紧急 eventId
- SLA job 重跑
- 重复设备离线检测
- 重复活动报名和最后一个名额竞争
- 重复支付 webhook
- 订单创建/确认重复提交
- 重复退款请求
- 重复 Agent tool call
- outbox 事件重复发布和消费者重放

## 6. 安全测试

- IDOR、跨租户、跨老人关系
- 班次结束后权限
- 同意撤回
- 文件上传和签名 URL
- 外部内容/服务商文本 prompt injection
- Agent 越权工具、模型伪造 ID、审批绕过
- 支付 webhook 重放、金额篡改、订单错配
- 日志脱敏和错误响应
- 导出大规模敏感数据
- 服务商跨订单读取

## 7. AI 测试

- 默认全部 fixture/fake，不调用外部模型。
- 同一输入 deterministic。
- schema 无效、超时、空输出和危险建议降级。
- 多意图拆分，紧急优先于活动/商业。
- 情绪仅趋势观察，无诊断措辞。
- 家庭沟通不冒充、不秘密说服。
- ContentNewsAgent 只读取已发布内容。
- ServiceRecommendationAgent 在 suppression 状态下无法展示付费推荐。
- OperationsAgent 只能返回授权聚合数据。

## 8. 非功能测试

- 列表分页、工作台聚合、事件写入、地图 presence
- 活动报名高峰和订单查询
- 队列积压、dead letter 可见和安全重放
- WebSocket 订阅范围
- 移动弱网/断网草稿
- 可访问性：axe + 人工老人端流程
- 恢复：数据库 reset/seed、worker 重启、MQTT/Redis 短暂不可用

## 9. 测试数据

只使用虚构数据。AI 音频可用合成/公开许可短素材，默认使用 fixture 文本。Fake Payment 不接真实账户。新闻 fixture 必须注明虚构/测试来源，避免演示时误认为实时新闻。

## 10. 追踪矩阵

每个 milestone prompt 都要列出：

- 业务验收条目
- API/事件/状态机
- 正向权限测试
- 负向权限测试
- 失败/降级
- E2E 场景编号

M16 必须生成一份自动化覆盖矩阵，证明每个端到端旅程至少有一条自动化测试和一条失败场景。

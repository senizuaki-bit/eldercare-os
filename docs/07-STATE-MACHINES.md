# 07 — 状态机与业务规则

所有状态转换通过领域服务、权限校验和事务完成；禁止 UI 或通用 CRUD 直接改状态字段。

## 1. 工单

```text
NEW -> ASSIGNED -> ACCEPTED -> IN_PROGRESS -> COMPLETED -> VERIFIED -> CLOSED
  \-> CANCELLED
```

规则：

- NEW 只有主管/规则服务可分配。
- ACCEPTED 必须是当前被分配人员或有再分配权限者。
- `WORK_ORDER.ARRIVED` 不是工单状态。到场时追加不可变 `WorkOrderArrival` 记录与 `arrivedAt` 时间戳，状态保持 `ACCEPTED`，同时递增聚合版本；随后“开始处理”才转换为 `IN_PROGRESS`。
- COMPLETED 需要完成说明；当工单为 `IMMEDIATE_REVIEW`，或主需求要求人工复核、属于健康/紧急类别、命中任一安全规则时，服务端判定为高风险并要求结构化完成清单。
- 高风险清单固定为“服务对象状态已核对、服务结果已核对、后续风险已复核”三项。客户端只能逐项确认；服务端在串行化事务内拒绝缺失、部分、重复、未知或低风险多传的清单，并保存 schema version、风险原因、固定代码、确认时间和提交人员关联。
- `ServiceCompletion.completionChecklist` 与 `checklistConfirmedAt` 形成不可漂移的审计快照；家属摘要不得包含内部清单、完成说明或风险规则明细。
- 家属可见摘要和内部记录分离。
- VERIFIED 由老人、主管或配置的流程完成。
- CLOSED 后修改需创建更正记录，不能覆盖历史。

## 2. 紧急事件

```text
OPEN -> ACKNOWLEDGED -> RESPONDING -> RESOLVED -> REVIEWED
```

规则：

- OPEN 立即启动 SLA 和通知。
- ACKNOWLEDGED 记录人员和设备/客户端时间。
- RESPONDING 表示人员已出发/到场，字段分开记录。
- RESOLVED 需要处置摘要、结果、是否通知家属。
- REVIEWED 需要主管复盘或豁免原因。
- 同一设备 eventId 幂等；相近重复可关联但不能静默丢弃。
- AI 无权直接 RESOLVED/REVIEWED。

## 3. 设备告警

```text
ACTIVE -> ACKNOWLEDGED -> MAINTENANCE -> RECOVERED -> CLOSED
```

- RECOVERED 需要连续稳定心跳窗口。
- 关键设备告警必须有 fallback patrol。
- 设备恢复不自动关闭维修和巡查，需确认。

## 4. 情绪观察

```text
GENERATED -> NEEDS_REVIEW -> CONFIRMED | DISMISSED -> ARCHIVED
```

只表示观察是否被人工确认，不表示医学结论。CONFIRMED 可触发关怀任务和商业推荐暂停；恢复需人工或明确规则。

## 5. 家属沟通

```text
REQUESTED -> DRAFTED -> NEEDS_APPROVAL -> APPROVED -> DELIVERED -> CLOSED
                           \-> REJECTED
                    DELIVERED -> DECLINED_BY_ELDER
```

涉及医疗、财务、法律或高风险关系内容时强制 NEEDS_APPROVAL。老人拒绝后不能自动重复触达。

## 6. 内容

```text
DRAFT -> IN_REVIEW -> APPROVED -> SCHEDULED -> PUBLISHED -> ARCHIVED
                 \-> REJECTED
PUBLISHED -> RETRACTED
```

- 作者和审核人在生产配置中应分离。
- 新闻必须有来源和发布时间。
- RETRACTED 立即停止新播报，保留更正关系和审计。

## 7. 活动场次

```text
DRAFT -> PUBLISHED -> OPEN_FOR_ENROLLMENT -> FULL | CLOSED_FOR_ENROLLMENT
      -> IN_PROGRESS -> COMPLETED -> REVIEWED
      -> CANCELLED
```

容量、时间和场地冲突在事务内校验。收费活动取消必须关联退款/权益返还。

## 8. 活动报名

```text
RECOMMENDED -> INVITED -> ENROLLED -> CONFIRMED -> ATTENDED
                     \-> DECLINED
                     \-> WAITLISTED
                     \-> CANCELLED
CONFIRMED -> NO_SHOW
```

同一老人同一场次最多一个有效报名。需要陪同时，报名确认前或同时生成护送任务。

## 9. 服务推荐

```text
CREATED -> PRESENTED -> ACCEPTED | DECLINED | EXPIRED | SUPPRESSED
```

- CREATED 必须保存推荐原因、来源和版本。
- SUPPRESSED 用于安全/同意/频控阻止，不得绕过。
- DECLINED 后同类推荐进入频控。
- 推荐本身不能等同于订单或支付。

## 10. 订单

```text
DRAFT -> PENDING_CONFIRMATION -> PENDING_PAYMENT -> PAID
     -> FULFILLMENT_SCHEDULED -> IN_FULFILLMENT -> FULFILLED
     -> COMPLETED
     -> CANCELLED
     -> REFUND_REQUESTED -> PARTIALLY_REFUNDED | FULLY_REFUNDED
```

规则：

- 金额/长期订阅/认知支持条件触发二次确认。
- PENDING_PAYMENT 期间重复请求复用幂等键。
- PAID 只能由经过验证的支付结果转换。
- FULFILLED 需要完成记录；COMPLETED 在确认/争议窗口后。
- 已支付取消必须经过退款或明确不可退规则确认。
- AI 无权直接完成支付、退款或高额确认。

## 11. 支付尝试

```text
CREATED -> PENDING -> SUCCEEDED | FAILED | CANCELLED | UNKNOWN
SUCCEEDED -> REFUND_PENDING -> PARTIALLY_REFUNDED | FULLY_REFUNDED | REFUND_FAILED
```

UNKNOWN 必须通过查询或 webhook 对账，不得让用户盲目重复支付。providerEventId 唯一。

## 12. 履约任务

```text
CREATED -> ASSIGNED -> ACCEPTED -> IN_PROGRESS -> FULFILLED -> VERIFIED -> CLOSED
       -> CANCELLED | DISPUTED
```

可映射到 WorkOrder，但订单状态和工单状态不能直接共用一个字段；通过事件同步。

## 13. 智能体执行

```text
CREATED -> ROUTED -> RUNNING -> WAITING_FOR_APPROVAL -> EXECUTING_TOOL -> COMPLETED
                    \-> FAILED
WAITING_FOR_APPROVAL -> REJECTED | EXPIRED
```

- 每个 AgentRun 有最大步数和超时。
- 工具调用有独立状态和幂等键。
- 审批通过后重新校验当前权限、同意和业务状态。
- 失败不能假装业务已执行。

## 14. 审批

```text
PENDING -> APPROVED | REJECTED | EXPIRED | CANCELLED
```

高风险审批记录请求者、建议动作、风险原因、审批人、时间、过期时间和执行结果。审批不是一次性权限提升，只授权具体动作。

## 15. 状态转换实现

- 单独 domain service
- 事务内校验当前状态、权限、同意和关联资源
- 乐观锁/版本字段防并发覆盖
- 生成不可变 transition 和 audit event
- 跨模块副作用使用 outbox/可靠事件模式
- 外部支付/MQTT/通知事件使用幂等和重放保护
- 任何状态机都提供允许/拒绝转换单元测试和并发测试

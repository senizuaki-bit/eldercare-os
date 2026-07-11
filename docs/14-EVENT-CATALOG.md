# 14 — 领域事件目录与集成契约

所有跨模块副作用通过事务 outbox 发布领域事件。模块可同步校验自身业务，但不得通过直接写入其他模块表来“偷接流程”。

## 1. 统一事件信封

```json
{
  "eventId": "ulid",
  "eventType": "WORK_ORDER.ASSIGNED",
  "schemaVersion": "1.0",
  "organizationId": "org-id",
  "facilityId": "facility-id",
  "aggregateType": "WorkOrder",
  "aggregateId": "work-order-id",
  "aggregateVersion": 4,
  "actor": {
    "type": "USER|SYSTEM|DEVICE|AGENT",
    "id": "actor-id"
  },
  "correlationId": "journey-id",
  "causationId": "previous-event-id",
  "idempotencyKey": "producer-defined-key",
  "occurredAt": "2026-07-10T12:00:00Z",
  "data": {},
  "privacyClass": "OPERATIONS|SENSITIVE|HIGHLY_SENSITIVE"
}
```

规则：

- `eventId` 全局唯一；消费者按 `eventId` 幂等。
- `aggregateVersion` 防止乱序覆盖。
- 事件不放原始录音、完整转写、精确长期轨迹或支付凭证。
- 敏感详情通过授权 API 读取。
- 事件 schema 只做向后兼容扩展；破坏性变更提升大版本。

## 2. 身份、组织与老人

| 事件 | 触发 | 主要消费者 |
|---|---|---|
| ORGANIZATION.CREATED | 创建组织 | 配置、审计 |
| FACILITY.CREATED | 创建院区 | 地图、权限、设备 |
| USER.INVITED | 用户邀请 | 通知、审计 |
| ROLE.ASSIGNED | 分配角色/范围 | 会话失效、审计 |
| ELDER.CREATED | 创建老人档案 | 时间线、搜索 |
| ELDER.ADMITTED | 入住生效 | 床位、照护、家属通知 |
| ELDER.TRANSFERRED | 房间/院区转移 | 设备绑定、任务、地图 |
| ELDER.DISCHARGED | 出院/离院 | 权限、设备、提醒、保留期 |
| CONSENT.GRANTED | 分项同意 | AI、定位、内容、共享 |
| CONSENT.WITHDRAWN | 撤回同意 | 停止处理、删除/保留任务 |
| FAMILY.RELATIONSHIP_VERIFIED | 家属关系验证 | 家属门户、通知 |

## 3. 语音、需求与工单

| 事件 | 触发 | 主要消费者 |
|---|---|---|
| VOICE_SUBMISSION.CREATED | 上传语音 | 转写队列 |
| TRANSCRIPT.COMPLETED | 转写完成 | AI 分析 |
| TRANSCRIPT.FAILED | 转写失败 | 人工复核、通知 |
| AI_NEED_ANALYSIS.COMPLETED | AI 结构化输出通过 | 风险规则、复核队列 |
| AI_NEED_ANALYSIS.FAILED | AI 失败 | 人工需求创建 |
| NEED.CREATED | 需求建立 | 工单、时间线、报表 |
| NEED.REVIEW_REQUIRED | 需人工复核 | 主管队列 |
| NEED.SPLIT | 一个输入拆为多需求 | 时间线、关联 |
| WORK_ORDER.CREATED | 创建工单 | 调度、通知 |
| WORK_ORDER.ASSIGNED | 完成分配 | 护工推送、SLA |
| WORK_ORDER.ACCEPTED | 护工接单 | 主管、SLA |
| WORK_ORDER.ARRIVED | 到场 | 计时、家属可选摘要 |
| WORK_ORDER.COMPLETED | 服务完成草稿确认 | 验证、摘要、评价 |
| WORK_ORDER.VERIFIED | 服务复核 | 家属摘要、评价、绩效 |
| WORK_ORDER.CLOSED | 正式关闭 | 报表、归档 |
| WORK_ORDER.CANCELLED | 取消 | 通知、释放资源 |
| WORK_ORDER.OVERDUE | 超时 | 升级、重派 |
| RATING.SUBMITTED | 老人/家属评价 | 质检、绩效 |
| RATING.DISPUTED | 评分申诉 | 主管复核 |

## 4. 紧急事件

| 事件 | 触发 | 主要消费者 |
|---|---|---|
| EMERGENCY.OPENED | 呼救/规则/设备 | 调度、通知、SLA |
| EMERGENCY.ACKNOWLEDGED | 人员确认 | 升级计时 |
| EMERGENCY.RESPONDING | 出发/到场 | 主管、家属策略 |
| EMERGENCY.ESCALATED | SLA 超时 | 上级/备用人员 |
| EMERGENCY.RESOLVED | 现场处置完成 | 家属摘要、复盘 |
| EMERGENCY.REVIEWED | 主管复盘完成 | 报表、改进项 |
| EMERGENCY.RELATED_DUPLICATE | 重复事件关联 | 审计、去重统计 |

## 5. 设备与位置

| 事件 | 触发 | 主要消费者 |
|---|---|---|
| DEVICE.REGISTERED | 设备注册 | 地图、监控 |
| DEVICE.BOUND | 绑定老人/区域 | 权限、监控 |
| DEVICE.HEARTBEAT_RECEIVED | 心跳 | 在线状态 |
| DEVICE.OFFLINE_DETECTED | 超阈值 | 告警、维修、巡查 |
| DEVICE.RECOVERY_DETECTED | 恢复窗口开始 | 告警状态 |
| DEVICE.STABLE_RECOVERED | 稳定恢复 | 人工关闭检查 |
| DEVICE.ALERT_CLOSED | 告警关闭 | 报表 |
| FALLBACK_PATROL.CREATED | 关键设备离线 | 护工任务 |
| LOCATION.SAMPLE_ACCEPTED | 有效位置 | presence、地图 |
| LOCATION.SAMPLE_REJECTED | 无效/越界/签名失败 | 设备安全 |
| LOCATION.BECAME_STALE | TTL 到期 | UI、调度降级 |

## 6. 情绪与家庭沟通

| 事件 | 触发 | 主要消费者 |
|---|---|---|
| EMOTION_OBSERVATION.GENERATED | AI 生成观察 | 人工复核 |
| EMOTION_OBSERVATION.CONFIRMED | 人工确认 | 关怀任务、推荐暂停策略 |
| EMOTION_OBSERVATION.DISMISSED | 人工驳回 | AI 质量 |
| COMMUNICATION.REQUESTED | 家属提出沟通需求 | 沟通智能体 |
| COMMUNICATION.DRAFTED | 草稿生成 | 家属/工作人员审核 |
| COMMUNICATION.APPROVED | 审核通过 | 触达任务 |
| COMMUNICATION.DELIVERED | 老人收到/听取 | 时间线、后续任务 |
| COMMUNICATION.DECLINED | 老人拒绝 | 停止/频控 |

## 7. 内容与新闻

| 事件 | 触发 | 主要消费者 |
|---|---|---|
| CONTENT.INGESTED | 外部内容进入草稿 | 审核 |
| CONTENT.APPROVED | 审核通过 | 排期 |
| CONTENT.PUBLISHED | 发布 | 推荐、搜索 |
| CONTENT.RETRACTED | 撤回/更正 | 停播、通知 |
| CONTENT.PLAYBACK_STARTED | 开始播报 | 轻量分析 |
| CONTENT.PLAYBACK_COMPLETED | 完成 | 偏好 |
| CONTENT.FEEDBACK_RECORDED | 跳过/喜欢/不准确 | 偏好、质检 |
| CONTENT.PREFERENCE_UPDATED | 老人修改偏好 | 推荐 |

## 8. 活动与兴趣

| 事件 | 触发 | 主要消费者 |
|---|---|---|
| INTEREST_PROFILE.UPDATED | 兴趣变化 | 推荐 |
| ACTIVITY.PUBLISHED | 活动开放 | 推荐 |
| ACTIVITY.RECOMMENDED | 生成推荐 | 老人端/通知 |
| ACTIVITY.ENROLLED | 报名成功 | 容量、提醒 |
| ACTIVITY.WAITLISTED | 候补 | 通知 |
| ACTIVITY.CANCELLED | 场次取消 | 通知、退款 |
| ACTIVITY.ESCORT_REQUIRED | 需要陪同 | 工单 |
| ACTIVITY.CHECKED_IN | 到场 | 参与统计 |
| ACTIVITY.NO_SHOW | 未到场 | 原因记录 |
| ACTIVITY.COMPLETED | 场次完成 | 反馈、报表 |
| ACTIVITY.FEEDBACK_SUBMITTED | 评价 | 质量分析 |

## 9. 服务、推荐与订单

| 事件 | 触发 | 主要消费者 |
|---|---|---|
| SERVICE.PUBLISHED | 服务上架 | 目录、推荐 |
| SERVICE.PACKAGE_SUBSCRIBED | 订阅服务包 | 权益、账单 |
| ENTITLEMENT.GRANTED | 权益生效 | 下单、提醒 |
| RECOMMENDATION.CREATED | 生成推荐 | 推荐流、审计 |
| RECOMMENDATION.ACCEPTED | 接受 | Checkout |
| RECOMMENDATION.DECLINED | 拒绝 | 频控、偏好 |
| CHECKOUT.INTENT_CREATED | 创建结算意向 | 确认/支付 |
| ORDER.CREATED | 订单建立 | 支付、履约 |
| ORDER.CONFIRMED | 老人/家属确认 | 支付 |
| PAYMENT.SUCCEEDED | 支付成功 | 履约、权益 |
| PAYMENT.FAILED | 支付失败 | 通知、重试 |
| ORDER.FULFILLMENT_SCHEDULED | 安排服务 | 工单/服务商 |
| ORDER.FULFILLMENT_STARTED | 服务开始 | 计时 |
| ORDER.FULFILLED | 服务完成 | 确认、评价 |
| ORDER.COMPLETED | 争议期后完成 | 结算、报表 |
| REFUND.REQUESTED | 请求退款 | 审核 |
| REFUND.COMPLETED | 退款完成 | 账务、通知 |
| COMMERCIAL_RECOMMENDATIONS.PAUSED | 风险策略暂停 | 推荐引擎 |
| COMMERCIAL_RECOMMENDATIONS.RESUMED | 人工恢复 | 推荐引擎 |

## 10. 智能体与审批

| 事件 | 触发 | 主要消费者 |
|---|---|---|
| AGENT.RUN_STARTED | 选择智能体 | 观测、预算 |
| AGENT.TOOL_REQUESTED | 请求工具 | 策略网关 |
| AGENT.TOOL_DENIED | 权限/风险拒绝 | 安全报表 |
| AGENT.RUN_COMPLETED | 生成结果 | 业务模块 |
| AGENT.RUN_FAILED | 执行失败 | 降级、人工 |
| APPROVAL.REQUESTED | L2/L3 动作 | 审批队列 |
| APPROVAL.APPROVED | 人工批准 | 工具执行 |
| APPROVAL.REJECTED | 人工拒绝 | 通知、审计 |
| HUMAN_HANDOFF.CREATED | 转人工 | 任务队列 |

## 11. 通知、报表与审计

| 事件 | 触发 | 主要消费者 |
|---|---|---|
| NOTIFICATION.REQUESTED | 业务请求通知 | 通知适配器 |
| NOTIFICATION.DELIVERED | 送达 | 业务状态 |
| NOTIFICATION.FAILED | 失败 | 重试/人工 |
| FAMILY_SUMMARY.PUBLISHED | 摘要发布 | 家属端 |
| REPORT.SNAPSHOT_GENERATED | 定时报表 | 工作台、导出 |
| EXPORT.REQUESTED | 用户申请导出 | 审批、任务 |
| EXPORT.COMPLETED | 导出完成 | 下载通知 |
| RETENTION.DELETION_DUE | 到期 | 删除任务 |
| DATA.DELETED | 删除完成 | 审计、索引清理 |
| SECURITY.ACCESS_DENIED | 敏感访问拒绝 | 安全监控 |

## 12. 事件处理约束

- 通知失败不能回滚已成功的业务事务。
- 报表采用事件或数据库快照聚合，可重建。
- 关键副作用（紧急升级、支付、退款、设备告警）需要幂等锁和唯一约束。
- 消费者不得假设事件严格全局有序，只可依赖同一聚合版本。
- 死信队列必须在管理端/运维面板可见并可安全重放。
- 重放前再次执行权限与当前状态检查，避免旧事件覆盖新状态。

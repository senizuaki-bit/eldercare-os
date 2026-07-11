# 04 — 领域数据模型

## 1. 身份与组织

- Organization
- Facility
- Building
- Floor
- Zone
- Room
- Bed
- User
- Role
- Permission
- UserRole
- DataScope
- StaffProfile
- Team
- Shift
- ShiftAssignment
- ApprovalPolicy
- ApprovalRequest
- ApprovalDecision

## 2. 老人与关系

- Elder
- ElderStay
- CareLevel
- ElderCareAssignment
- FamilyRelationship
- EmergencyContact
- ConsentRecord
- SharingPreference
- CommunicationPreference
- AccessibilityProfile
- PersonalBaseline
- CareNote
- CarePlan
- MedicationPlan（仅计划和提醒，不做处方决策）
- AdmissionRecord
- ElderTimelineEntry

## 3. 需求与服务工单

- VoiceSubmission
- Transcript
- AIAnalysis
- AIReview
- Need
- NeedLink
- WorkOrder
- WorkOrderAssignment
- WorkOrderTransition
- ServiceCompletion
- FamilySummary
- Rating
- RatingDispute
- QualityReview

## 4. 紧急与设备

- EmergencyEvent
- EmergencyTransition
- EmergencyRelatedEvent
- EscalationPolicy
- EscalationStep
- Device
- DeviceBinding
- DeviceHeartbeat
- DeviceTelemetry
- DeviceEvent
- DeviceAlert
- MaintenanceWorkOrder
- FallbackPatrolTask

## 5. 地图和位置

- FloorPlan
- MapAnchor
- LocationSample
- LocationPresence
- GeofenceRule

`LocationSample` 至少包括：subject type/id、facility、floor、x/y、zone/room、source、accuracy、observedAt、expiresAt、signature/ingestion metadata。

## 6. AI、情绪与沟通

- PromptVersion
- AIProviderRun
- EmotionObservation
- EmotionReview
- CommunicationRequest
- CommunicationDraft
- CommunicationApproval
- HumanHandoff

AI 原始建议与人工修正分开保存；任何诊断字段都不属于本模型。

## 7. 内容与偏好

- ContentSource
- ContentItem
- ContentVersion
- ContentReview
- ContentSchedule
- ContentPlayback
- ContentFeedback
- ContentPreference
- SpeechAsset

`ContentItem` 保存：类型、来源、原始发布日期、地区、审核状态、赞助标识和更正/撤回关系。

## 8. 兴趣与活动

- InterestTaxonomy
- InterestProfile
- ActivityTemplate
- ActivitySession
- ActivityEligibilityRule
- ActivityRecommendation
- ActivityEnrollment
- ActivityAttendance
- ActivityFeedback
- ActivityEscortTask

## 9. 服务目录、套餐与权益

- ServiceProvider
- ProviderStaff
- ServiceOffering
- ServiceVariant
- ServiceAvailability
- ServicePackage
- PackageItem
- Subscription
- Entitlement
- EntitlementUsage
- Recommendation
- RecommendationReason
- RecommendationFeedback
- RecommendationSuppression

## 10. 订单、支付与履约

- CheckoutIntent
- Order
- OrderItem
- OrderConfirmation
- PaymentAttempt
- PaymentEvent
- FulfillmentTask
- FulfillmentAssignment
- FulfillmentEvidence
- RefundRequest
- RefundEvent
- SettlementRecord
- CommerceDispute

真实支付凭证不进入数据库；只保存提供方 token/reference 和最小状态。

## 11. 智能体编排

- AgentDefinition
- AgentVersion
- AgentToolDefinition
- AgentToolGrant
- AgentSession
- AgentRun
- AgentToolCall
- AgentPolicyDecision
- AgentFeedback

`AgentRun` 只保存可审计摘要、工具调用和最终结果，不保存不必要的隐藏推理。

## 12. 事件、通知与报表

- OutboxEvent
- InboxProcessedEvent
- DeadLetterEvent
- Notification
- NotificationDelivery
- ReportDefinition
- ReportSnapshot
- AnalyticsFact（可选）

## 13. 审计与隐私

- AuditEvent
- AccessLog
- DataExportRequest
- DeletionRequest
- RetentionPolicy
- RetentionJob
- PrivacyImpactAssessmentRecord（项目级元数据，可选）

## 14. 通用字段

业务实体通常包括：

- id (UUID/ULID)
- organizationId
- facilityId（适用时）
- createdAt/updatedAt
- createdBy/updatedBy（适用时）
- status
- version/optimistic concurrency（状态机实体）
- correlationId（旅程关联）

## 15. 关键唯一约束与完整性

- 一个床位同一时间最多一个有效入住记录。
- 家属关系必须绑定具体老人和共享范围。
- 同一同意类型的有效版本按老人+用途唯一，并保留历史。
- 工单、紧急、设备告警、活动、订单状态只通过 transition service 修改。
- 活跃设备离线告警按设备+告警类型唯一。
- 设备 eventId 和支付 providerEventId 唯一，支持幂等。
- 位置查询默认只返回最新未过期样本。
- AI 观察与人工复核分表/分字段，保留建议和修正。
- 活动报名按 session+elder 唯一；容量在事务内锁定。
- 订单号在组织内唯一；支付/退款调用使用唯一幂等键。
- 服务权益使用量不能小于零或超过授权额度。
- 推荐必须保存来源、原因、版本和是否付费/赞助。
- 情绪关怀高风险期间存在有效 `RecommendationSuppression` 时，商业推荐查询返回空或仅免费基础权益。
- AgentToolCall 只能关联已注册工具版本，且结果业务 ID 可追溯。
- OutboxEvent 与业务写入同事务；InboxProcessedEvent 防消费者重复副作用。

## 16. 删除与保留

不同数据采用不同保留期限：

- 原始音频：短期，转写/复核后按策略删除。
- 转写和 AI 观察：按用途和同意保留，可匿名化/删除。
- 精确位置：短期；长期只保留区域级聚合（如确有必要）。
- 紧急/工单/订单/支付：按法务与运营要求保留不可变事实，访问严格控制。
- 内容播放和推荐日志：尽量聚合化，不无限保存逐次行为。
- 审计：受保护、不可被普通业务删除，但支持法定策略。

删除任务必须清理对象存储、索引、缓存和衍生数据，并保留不含敏感内容的删除完成审计。

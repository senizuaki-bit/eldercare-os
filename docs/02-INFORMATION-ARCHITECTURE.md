# 02 — 信息架构与屏幕清单

## 1. 管理端主导航与路由

```text
/dashboard

/incidents
/incidents/:id
/needs
/work-orders
/work-orders/:id

/elders
/elders/:id/overview
/elders/:id/care-plan
/elders/:id/medication-plan
/elders/:id/timeline
/elders/:id/consents
/elders/:id/interests
/elders/:id/services

/facility/buildings
/facility/floors
/facility/rooms
/facility/beds
/staff
/teams
/shifts
/map
/devices
/device-alerts

/family-communications
/content
/content/:id
/activities
/activities/:id
/activity-sessions/:id
/services/catalog
/services/packages
/orders
/orders/:id
/refunds
/providers

/agents
/agent-runs
/approvals
/recommendations
/reports
/performance
/users
/roles
/audit
/settings
```

主导航分组：

1. 工作台
2. 风险与事件
3. 需求与工单
4. 老人与入住
5. 护理、人员与排班
6. 地图与设备
7. 家属沟通
8. 内容与活动
9. 服务、订单与退款
10. 智能体与审批
11. 报表绩效
12. 权限、审计与设置

## 2. 移动端路由

角色识别后进入不同首页，但共享登录、通知、消息和个人设置。

### 老人端

```text
/m/elder/home
/m/elder/voice-request
/m/elder/emergency
/m/elder/schedule
/m/elder/news
/m/elder/content
/m/elder/activities
/m/elder/activities/:id
/m/elder/services
/m/elder/services/:id
/m/elder/orders
/m/elder/reviews
/m/elder/family
/m/elder/privacy
/m/elder/ai-settings
```

首屏固定优先级：语音需求、紧急求助、转人工、今日安排；新闻、活动和服务位于其后。

### 护工端

```text
/m/caregiver/home
/m/caregiver/tasks
/m/caregiver/tasks/:id
/m/caregiver/emergencies/:id
/m/caregiver/map
/m/caregiver/escorts
/m/caregiver/service-fulfillments
/m/caregiver/handover
/m/caregiver/profile
```

### 家属端

```text
/m/family/home
/m/family/elders/:id
/m/family/events
/m/family/activities
/m/family/services
/m/family/orders
/m/family/orders/:id
/m/family/communication-assistant
/m/family/consents
/m/family/payments
/m/family/profile
```

### 服务运营/供应商端（扩展）

首版可由管理端角色完成；独立门户预留：

```text
/m/provider/jobs
/m/provider/jobs/:id
/m/provider/settlements
/m/provider/quality
```

供应商只看到被分配订单和履约所需最小信息。

## 3. 管理工作台组件

第一屏：

- 未确认紧急事件
- 待人工复核 AI 需求
- 超时工单
- 关键设备离线
- 待审批高风险智能体动作

第二屏：

- 今日在院/入住/床位
- 当前值班人员和负荷
- 今日活动、报名、护送和到场
- 待履约订单、退款和服务异常
- 家属待回复

分析区：

- 需求分类和响应时间
- 紧急事件 SLA
- 设备可用率
- 活动参与度
- 内容播报与偏好
- 服务包、订单和退款
- AI 人工修正率与失败率

## 4. 核心详情抽屉

### 老人快速详情

- 基本信息和房间
- 护理等级/注意事项
- 当前风险
- 今日安排
- 最近需求、事件、活动和订单
- 兴趣和内容偏好
- 授权共享状态

### 工单快速详情

- 来源和 AI 摘要
- 原始内容的受限入口
- 风险规则命中
- 当前负责人/SLA
- 状态时间线
- 内部记录与家属摘要分离
- 关联活动/订单/设备告警

### 设备快速详情

- 设备类型、绑定对象、位置
- 在线、电量、信号、固件
- 最近心跳与离线时长
- 活跃告警和维修工单
- 是否已创建替代巡查

### 活动快速详情

- 场次、场地、负责人、容量
- 适用条件和陪同要求
- 推荐/报名/候补/签到
- 关联护送工单
- 收费状态和退款影响

### 订单快速详情

- 服务、价格、权益、推荐原因
- 老人/家属确认和支付状态
- 履约人员、时间和完成记录
- 退款、争议和评价
- 敏感字段访问审计

### 智能体执行详情

- 主智能体与选择原因
- 风险等级、同意快照
- 工具请求/允许/拒绝
- 人工审批
- 最终生成的业务对象
- 模型/Prompt/Schema 版本

## 5. 全局老人 360 时间线

时间线按权限聚合引用：

- 入住、转房、出院
- 需求、工单、紧急事件
- 设备告警与替代巡查
- 情绪观察与关怀任务
- 家属沟通
- 内容播报
- 活动推荐、报名和参与
- 服务推荐、订单、履约、退款
- 评价和授权变化

时间线不直接复制原始录音、完整转写、精确轨迹或支付凭证；需要时通过受限详情接口读取。

## 6. 搜索与全局命令

全局搜索按权限支持：

- 老人姓名/房间/床位
- 工单/紧急事件编号
- 设备编号
- 活动/服务/订单编号

运营 AI 查询位于独立入口，不等同于全局搜索；它只执行授权聚合工具。

## 7. 空状态和错误状态

每个页面必须提供：loading、empty、error、offline、forbidden、stale。

示例：

- 没有紧急事件：“当前没有未处理紧急事件”。
- 没有位置：“尚未收到有效位置”，提供设备/权限/时间排查入口。
- 没有 AI 结果：“分析失败或尚未完成”，提供人工创建需求。
- 无可推荐活动：“当前没有符合本人偏好和条件的活动”，允许浏览全部公开活动。
- 商业推荐暂停：“当前优先处理照护事项，暂不展示付费推荐”。
- 支付不确定：“正在确认支付结果，请勿重复支付”。

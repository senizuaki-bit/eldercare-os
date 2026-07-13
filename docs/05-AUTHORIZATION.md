# 05 — 权限模型

## 1. 模型

`RBAC + 数据范围 + 资源关系 + 状态约束 + 同意用途 + 人工审批 + 临时紧急授权`

任何前端菜单隐藏都不能替代后端授权。

## 2. 角色

- PLATFORM_ADMIN
- ORG_ADMIN
- FACILITY_DIRECTOR
- NURSING_SUPERVISOR
- CAREGIVER
- CLINICAL_STAFF
- DEVICE_MANAGER
- CONTENT_EDITOR
- ACTIVITY_COORDINATOR
- SERVICE_OPERATOR
- PROVIDER_STAFF
- FINANCE_VIEWER
- ELDER
- FAMILY

一个用户可以有多个角色，但每个角色必须绑定组织/院区/数据范围。

## 3. 权限示例

### 身份、会话与机构

- session.self.read
- session.self.manage
- organization.read
- facility.read
- identity.user.read
- identity.role.read
- identity.access.manage
- audit.read

### 老人和照护

- elder.read.basic
- elder.read.sensitive
- elder.update
- elder.timeline.read
- consent.manage
- care_plan.read
- care_plan.update
- work_order.assign
- work_order.transition
- emergency.acknowledge
- emergency.resolve
- ai.review
- family_summary.publish

### 设备和位置

- device.manage
- device.alert.transition
- location.read.elder
- location.read.staff
- floor_plan.manage

### 内容和活动

- content.create
- content.review
- content.publish
- content.retract
- activity.manage
- activity.enrollment.manage
- activity.attendance.manage

### 服务交易

- service.catalog.manage
- service.package.manage
- recommendation.review
- order.read
- order.confirm
- order.fulfill
- order.refund
- payment.read.reference
- settlement.read

### 智能体与运营

- agent.definition.manage
- agent.run.read
- agent.approval.decide
- report.read
- report.export
- performance.read

## 4. 数据范围

- platform
- organization
- facility
- building/floor/zone
- care team
- assigned elders
- active shift
- linked elder
- assigned activity
- assigned order/provider
- own records

M01 已落地的数据范围种类为 `PLATFORM`、`ORGANIZATION`、`FACILITY`、`FLOOR`、`CARE_TEAM`、`ASSIGNED_ELDER`、`ACTIVE_SHIFT`、`LINKED_ELDER` 和 `OWN_RECORD`。`ACTIVE_SHIFT` 必须有有效起止时间，过期后不能继续授权；活动、订单和服务商范围在对应后续里程碑实现。

## 5. 同意用途

即便角色和范围允许，下列处理仍需有效同意或法定例外：

- 语音采集/转写
- AI 需求分析
- 情绪趋势
- 老人/护工位置
- 家属共享
- 内容个性化
- 商业推荐
- 家属代付
- AI 记忆

工具网关必须在调用时获取同意快照，不能只在开户时检查一次。

## 6. 关键规则

### 家属

家属只访问绑定老人的授权摘要、活动/服务/订单和本人可管理的同意。不能读取：

- 原始语音/完整转写
- 护工内部备注
- 护工实时位置
- 其他老人和家属
- 未经授权的情绪/健康详情
- 机构内部绩效和供应商结算

代付需要关系、老人知情、订单确认权限和金额规则。

### 护工

- 只在有效班次和分配范围内访问必要老人信息。
- 可查看完成任务所需注意事项，不默认读取完整健康档案。
- 班次结束后位置采集和普通访问停止。
- 紧急临时授权必须关联事件、原因、时间和审计。

### 设备管理员

可看设备、位置绑定和故障影响，但默认不能看详细健康、情绪、家属沟通和商业订单。

### 内容/活动运营

可管理内容或活动和最小报名信息；不能查看原始照护记录、精确位置、家庭沟通和支付详情。

### 服务运营/供应商

- SERVICE_OPERATOR 可管理本机构服务和订单。
- PROVIDER_STAFF 只访问分配给其服务商/人员的履约任务和必要服务信息。
- 服务商不能浏览老人档案、其他订单、情绪观察或机构全量报表。

### 财务

只读取订单金额、支付/退款引用和结算；不读取原始语音、情绪、精确位置和无关健康内容。

### 智能体

AI 不拥有独立“超级角色”。每个工具调用继承发起者、关系、范围、同意和工具风险策略。禁止模型自行指定组织、老人或提升权限。

## 7. 状态和审批约束

- 紧急事件只有指定角色可转换，AI 无权关闭。
- 付费/高额/长期服务需要确认或审批。
- 内容发布需要审核人与作者分离（至少生产配置如此）。
- 退款超过阈值需要第二审批者。
- 评分不能由被评价人修改。
- 已关闭事实只能创建更正/冲销记录，不能覆盖历史。

## 8. 导出和批量操作

- 导出是独立权限。
- 记录查询条件、字段、行数、用途和下载者。
- 高敏感导出可要求二次验证和审批。
- 内容、活动和服务运营不可借批量接口导出老人敏感档案。

## 9. 测试矩阵

每个敏感接口至少测试：

1. 允许的同机构访问
2. 跨机构拒绝
3. 同机构但超出设施/楼层拒绝
4. 角色权限不足拒绝
5. 家属访问未绑定老人拒绝
6. 过期紧急授权拒绝
7. 前端隐藏不影响后端拒绝
8. 同意撤回后拒绝
9. 服务商跨订单拒绝
10. 内容/活动人员访问健康详情拒绝
11. 财务访问语音/位置拒绝
12. 智能体请求未授权工具拒绝
13. 审批未通过时业务工具拒绝
14. 跨租户 ID 枚举安全返回

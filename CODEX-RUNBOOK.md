# Codex 逐阶段运行手册

## 1. 初始化

```bash
unzip eldercare-codex-starter-pack-v3.zip
mv eldercare-codex-starter-v3 eldercare-os
cd eldercare-os
git init
git add .
git commit -m "chore: add eldercare end-to-end product and Codex specification"
```

打开 Codex 后先发送 `MASTER-PROMPT.md` 中的文本。确认它已读完全部文档、识别 M00–M16，且没有开始写代码。

## 2. 施工顺序

### 第一阶段：照护底座

严格执行：

```text
M00 -> M01 -> M02 -> M03 -> M04 -> M05 -> M06 -> M07 -> M08 -> M09 -> M10 -> M11
```

M11 结束后应得到可独立演示的照护 MVP。

### 第二阶段：平台扩展

在 M11 全绿后执行：

```text
M12 Content/News
-> M13 Activities/Interests
-> M14 Services/Commerce
-> M15 Agent Orchestration
-> M16 End-to-End Integration
```

禁止为了赶 M12–M16 而跳过核心权限、同意、事件、幂等和安全基础。

## 3. 执行一个里程碑

以 M00 为例：

```bash
git checkout -b feat/m00-foundation
```

向 Codex 发送：

```text
Read prompts/00-foundation.md and execute M00 only. Before editing, give me the file-by-file implementation plan and wait for my approval.
```

批准计划后再实施。完成时要求输出：

- 变更文件
- 数据库迁移及回滚
- 新依赖及原因
- API、事件、状态机和权限变化
- 新测试及对应验收旅程
- 已运行命令及精确结果
- 未解决问题
- 下一里程碑前置条件

## 4. 每次计划必须回答

1. 修改哪些文件，为什么？
2. 是否涉及 schema/migration？
3. 新增哪些 API/事件/队列？
4. 哪些角色可访问，哪些必须拒绝？
5. 需要哪些同意、确认或人工审批？
6. 幂等键、并发和失败重试怎么处理？
7. 敏感数据如何最小化、脱敏和保留？
8. 对应哪个端到端旅程和失败场景？
9. 如何回滚？

缺少这些答案时，不批准实施。

## 5. 本地验收

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

涉及流程：

```bash
pnpm test:e2e
```

检查：

```bash
git status
git diff --stat
git diff
```

发现问题时给出明确的小修复任务，不让 Codex 借机大范围重构。

## 6. 提交和 PR

```bash
git add .
git commit -m "feat: complete M00 foundation"
git push -u origin feat/m00-foundation
```

PR 合并门槛：

- 自动检查全绿
- 正向和负向权限测试通过
- 同意/审批规则不可绕过
- 无敏感日志和真实数据
- 迁移可重复执行并有回滚说明
- 关键页面有 loading/empty/error/offline/forbidden/stale/suppressed 状态
- 幂等与并发测试覆盖关键副作用
- 文档、OpenAPI、事件和命令一致
- `docs/TASK_STATUS.md` 已更新证据

## 7. M11 检查点

M11 合并前，不应存在：

- 只有页面没有后端的需求/紧急/设备/地图/AI 功能
- 通过 UI 隐藏代替服务端权限
- 把旧位置当实时位置
- 让 AI 独立诊断或关闭紧急事件
- 无替代巡查的关键设备离线

M11 可打标签：

```bash
git tag core-mvp-v0.1.0
```

## 8. M12–M16 特别检查

### 内容

- 是否先审核后播报？
- 来源、日期、赞助和撤回是否保留？
- 外部文本是否被当作不可信输入？

### 活动

- 容量和重复报名是否事务安全？
- 是否解释推荐原因并尊重拒绝？
- 护送是否生成真实工单？

### 商业

- 是否优先免费/已包含权益？
- 是否在紧急/情绪高风险期间暂停推荐？
- 支付、退款和 webhook 是否幂等？
- 家属代付、金额限制和退款是否真实可追踪？

### 智能体

- 是否只有受限工具而不是通用自主权限？
- 是否继承用户、关系、同意和数据范围？
- L2/L3 是否必须确认/审批？
- 是否避免保存不必要的隐藏推理？

## 9. M16 最终验收

按 `docs/15-END-TO-END-ACCEPTANCE.md` 逐项运行 A–J 旅程，并验证：

- 一条 correlationId 能追踪多意图输入到需求、审批、活动/订单、通知和报表。
- 重复设备、事件、支付、退款和工具调用不会产生重复副作用。
- 老人 360 时间线已连接所有模块。
- 每个角色只能看到应该看到的字段和动作。
- 所有外部能力都可用 Fake provider 在本地演示。

M16 可打标签：

```bash
git tag platform-demo-v0.2.0
```

## 10. 不允许的操作

- 一次提交多个里程碑
- 自行删除失败测试
- 通过放宽权限/同意/审批让 E2E 通过
- 用前端假数据掩盖后端未实现
- 把真实密钥写入仓库
- 无审计修改紧急、支付、退款或审批状态
- 让 AI 独立做医疗、急救、高额消费或处罚决定
- 把赞助内容伪装成新闻/照护建议
- 利用情绪或孤独推销服务
- 直接复制参考产品

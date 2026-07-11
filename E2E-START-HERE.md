# E2E Start Here

今天讨论的全部产品能力已经被统一为一条平台级闭环：

```text
机构配置/老人入住与同意
-> 老人、家属、护工、设备或定时内容产生输入
-> 权限/关系/同意校验
-> 规则与多智能体路由
-> 需求、紧急、设备、关怀、内容、活动或订单工作流
-> 人工审批与真实履约
-> 老人/家属反馈
-> 老人 360 时间线、报表、绩效和审计
```

先读：

1. `docs/11-END-TO-END-FLOWS.md` — 全部业务如何连接
2. `docs/13-MULTI-AGENT-ORCHESTRATION.md` — 智能体如何安全调用系统
3. `docs/14-EVENT-CATALOG.md` — 模块如何通过事件连接
4. `docs/15-END-TO-END-ACCEPTANCE.md` — 如何证明不是静态页面
5. `CODEX-RUNBOOK.md` — 按 M00–M16 施工

核心开发顺序：

```text
M00–M11 照护底座
-> M12 新闻内容
-> M13 兴趣活动
-> M14 服务套餐/订单/Fake Payment
-> M15 多智能体编排
-> M16 全流程集成验收
```

Codex 新会话先粘贴 `MASTER-PROMPT.md`，只允许它规划下一个未完成里程碑。

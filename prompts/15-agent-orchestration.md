# M15 — Multi-agent registry, routing, restricted tools and approvals

```text
Execute M15 only. M14 and all earlier milestones must be green.

Goal:
Provide one unified AI entry point backed by role-specific agents, a restricted tool gateway, consent/permission/risk policy, approval queue, audit and deterministic local fixtures.

Read first:
- docs/11-END-TO-END-FLOWS.md sections 17–18
- docs/13-MULTI-AGENT-ORCHESTRATION.md
- docs/14-EVENT-CATALOG.md agent/approval events
- docs/15-END-TO-END-ACCEPTANCE.md Journey I and J

Deliver:
1. AgentDefinition/version/tool/grant/session/run/tool-call/policy-decision and approval models.
2. packages/agents with registry, deterministic intent/risk router, policy engine, tool contracts and tool gateway.
3. Initial agents: CareCoordination, EmotionSupport, FamilyCommunication, ContentNews, Activity, HealthRecord, ServiceRecommendation, CaregiverCopilot, Operations.
4. Tool adapters for existing business services; no direct database, arbitrary SQL, shell or unrestricted network access.
5. Risk levels L0–L4, explicit-confirmation and human-approval flow with expiry and revalidation before execution.
6. Unified elder/family AI interaction UI that shows AI identity, current action, confirmation, failure and human handoff.
7. Admin agent registry/read-only config, run detail, tool calls, denied calls, approvals and metrics.
8. Multi-intent splitting with emergency/health concerns prioritized over activity and commerce.
9. Consent snapshots, relation/data-scope checks, minimal tool outputs and output privacy filtering.
10. Prompt-injection fixtures from user text, news content and provider descriptions.
11. Agent events, correlation IDs, observability, cost/latency fixtures and no unnecessary hidden-reasoning persistence.
12. Unit, integration, negative tool authorization and E2E Journey I/J tests.

Constraints:
- Do not create a general autonomous agent with unrestricted tools.
- Do not persist chain-of-thought; persist audit-safe summaries, tool calls, policy decisions and results.
- AI cannot diagnose, close emergencies, make staff punishment decisions, secretly persuade, pay or refund.

Acceptance:
- Every tool call is tied to actor, elder relation, permission, consent, risk level and policy decision.
- L2/L3 approvals cannot be bypassed by prompt or client input.
- Emergency intent suppresses/defers activity and commercial execution.
- Journey I and the OperationsAgent restrictions in Journey J pass.
```

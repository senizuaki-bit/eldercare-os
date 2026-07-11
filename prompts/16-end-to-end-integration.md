# M16 — Full end-to-end integration, event catalog and platform release

```text
Execute M16 only. M00–M15 must be complete and green.

Goal:
Prove that all capabilities discussed in the product specification form coherent, auditable end-to-end workflows rather than disconnected modules.

Read first:
- all docs, especially docs/11–15
- docs/TASK_STATUS.md
- existing DEMO.md and release scripts

Deliver:
1. Audit the implementation against every section of docs/11-END-TO-END-FLOWS.md and close only integration gaps, not unrelated redesigns.
2. Ensure all cross-module writes use documented application services and transactional outbox/domain events where required.
3. Implement/finish the unified event envelope, consumer inbox/idempotency, dead-letter visibility and safe replay for core documented events.
4. Finish Elder 360 timeline references across admission, needs, emergencies, devices, emotion, communication, content, activities, orders, fulfillment, refunds and ratings.
5. Connect notifications, family-safe summaries, dashboard/report aggregates and correlation IDs across journeys.
6. Add the full fictional “one elder day” seed scenario from docs/11 section 19.
7. Add Playwright/API automation for docs/15 Journeys A–J and a traceability matrix mapping journey steps to tests, APIs, events and screens.
8. Add failure automation: AI down, payment unknown/replay, MQTT replay, stale location, consent withdrawal, notification failure, prompt injection, duplicate jobs and weak network state where practical.
9. Extend DEMO.md with core and platform-extension scripts, expected records and reset commands.
10. Generate final route/API/event/state-machine inventory and known production gaps.
11. Run security/privacy/accessibility regression, dependency and secret scans.
12. Update README, CODEX-RUNBOOK, TASK_STATUS and release checklist.

Constraints:
- Do not hide missing backend behavior with UI mocks.
- Do not weaken authorization, approval, consent, suppression, idempotency or stale-location rules to make E2E pass.
- Do not add real keys, live news, real payments or real elder data.

Acceptance:
- All commands in docs/15 section 13 pass from a clean reset.
- Journeys A–J pass twice from reset state.
- A single correlationId can trace the multi-intent journey across voice, need, approval, activity/order, notifications and reporting.
- No critical event/approval/payment/device side effect duplicates under replay.
- Every role sees only the intended fields and actions.
- TASK_STATUS contains evidence for M00–M16.
```

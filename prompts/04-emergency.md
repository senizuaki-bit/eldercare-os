# M04 — Emergency event response and escalation

```text
Execute M04 only.

Goal:
Create an explicit, auditable emergency response workflow.

Deliver:
1. EmergencyEvent, transitions, related duplicate events, escalation policy, acknowledgements, responders, resolution and review models with correlation IDs.
2. State machine OPEN -> ACKNOWLEDGED -> RESPONDING -> RESOLVED -> REVIEWED.
3. API/service commands for transitions; no direct status mutation.
4. SLA/escalation BullMQ jobs with idempotency and cancellation on progress.
5. Admin emergency command center with timers, reasons and timeline.
6. Caregiver emergency mobile view with acknowledge, en route/on-site, resolution checklist and call-human actions.
7. Elder emergency button that gives immediate feedback and fallback phone instructions.
8. Family notification preference and privacy-filtered event summary.
9. Event deduplication/linking rules for repeated signals, using eventId idempotency while preserving related new events.
10. EMERGENCY.* outbox events, timeline references and unit/integration/E2E tests for timeout escalation, replay/duplicates, stale-or-missing location fallback, concurrent acknowledgement and unauthorized closure.

Constraints:
- AI never resolves or closes an emergency.
- Resolution requires human actor and summary.
- Review cannot be silently skipped.
- Notifications use fake provider locally.

Acceptance:
- A simulated emergency follows the complete state machine.
- Escalation fires once per threshold.
- Every transition is audited.
```

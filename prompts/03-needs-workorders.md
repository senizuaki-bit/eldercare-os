# M03 — Voice submissions, needs, work orders and ratings

```text
Execute M03 only.

Goal:
Implement the primary service workflow using fake AI fixtures, without the full production AI layer yet.

Deliver:
1. VoiceSubmission, Transcript, AIAnalysis fixture, Need/NeedLink, WorkOrder, assignment, transition, completion, family summary and Rating models, all carrying correlation IDs where relevant.
2. Audio metadata/upload abstraction using local MinIO; validate size/type and use signed URLs.
3. Deterministic fake transcription/analysis for known demo fixtures.
4. Need categories, urgency suggestion, deterministic safety-rule service and a simple multi-intent split fixture that can produce linked needs without executing future activity/commerce modules.
5. Work-order state machine with optimistic concurrency and audit.
6. Admin need review queue and work-order list/detail.
7. Caregiver mobile task list/detail, accept/start/complete and voice/text completion note.
8. Elder mobile voice-request flow with AI disclosure, cancel and human-help option.
9. Family-safe summary generation that excludes internal notes and raw transcript.
10. Elder rating after completion; ratings do not trigger punishment.
11. Real-time task update using WebSocket/SSE with authorization.
12. WORK_ORDER/NEED outbox events, Elder 360 timeline references, and tests for state transitions, concurrent acceptance, event idempotency, privacy filtering, file permissions and the full request-to-rating path.

Safety:
- Fake AI cannot make final emergency decisions.
- A health concern creates review/priority according to deterministic rules.
- AI failure must allow manual need/work-order creation.

Acceptance:
- Demo phrase creates a reviewable structured need and an auditable work order.
- Caregiver completes it and family sees only approved summary.
- Unauthorized users cannot access audio/transcript.
```

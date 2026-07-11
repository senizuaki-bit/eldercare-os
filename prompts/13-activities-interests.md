# M13 — Interests, activities, enrollment, escort and attendance

```text
Execute M13 only. M12 and all earlier milestones must be green.

Goal:
Connect elder interests to explainable activity recommendations, enrollment, capacity, escort work orders, attendance, feedback, timeline and reporting.

Read first:
- docs/11-END-TO-END-FLOWS.md section 13
- docs/12-CONTENT-ACTIVITY-COMMERCE.md sections 3–4
- docs/14-EVENT-CATALOG.md activity events
- docs/15-END-TO-END-ACCEPTANCE.md Journey G

Deliver:
1. Interest taxonomy/profile and activity template/session/eligibility/recommendation/enrollment/attendance/feedback/escort models.
2. Activity and enrollment state machines with transactional capacity and waitlist behavior.
3. Admin activity calendar/list/detail, capacity, eligibility, attendees, escort status and cancellation flow.
4. Elder mobile activity discovery with explainable recommendation, free/paid label, accessibility/escort requirement, enroll/decline/cancel.
5. Family authorized view and optional participation/payment handoff links.
6. Low-risk deterministic recommendation rules based on explicit interests, time, ability and consent; no ML dependency.
7. Required escort creates or links a WorkOrder and remains traceable from activity detail.
8. Check-in, no-show reason, completion and feedback flows.
9. ACTIVITY.* events, notifications, elder timeline and analytics.
10. Concurrency tests for last capacity slot, duplicate enrollment idempotency and cancellation/refund handoff event.
11. E2E Journey G including waitlist and escort.

Constraints:
- Recommendations are optional and explainable.
- Do not infer medical eligibility from AI; use staff-configured rules and allowed care context.
- Long-term non-participation may create a care suggestion, never forced enrollment or negative performance.

Acceptance:
- Capacity never goes negative or exceeds the configured limit.
- Duplicate enrollment is idempotent.
- Escort-required enrollment produces a real auditable work-order link.
- Journey G passes from reset seed data.
```

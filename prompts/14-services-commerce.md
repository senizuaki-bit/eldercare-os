# M14 — Service catalog, packages, safe recommendations, orders and fake payments

```text
Execute M14 only. M13 and all earlier milestones must be green.

Goal:
Implement a safe, auditable service-commerce workflow connected to explicit needs, entitlements, family confirmation, fulfillment work, ratings, refunds, timeline and reporting.

Read first:
- docs/11-END-TO-END-FLOWS.md section 14
- docs/12-CONTENT-ACTIVITY-COMMERCE.md sections 5–12
- docs/07-STATE-MACHINES.md order/payment/fulfillment states
- docs/14-EVENT-CATALOG.md service/order events
- docs/15-END-TO-END-ACCEPTANCE.md Journey H

Deliver:
1. Service provider/offering/variant/package/subscription/entitlement/recommendation/order/payment/fulfillment/refund models and migrations.
2. Admin service catalog, package, order, fulfillment, refund and provider-assignment screens.
3. Elder/family service detail with price, included scope, provider type, recommendation reason, entitlement, cancellation/refund and sponsored label.
4. Recommendation rules that require explicit need, active consent and no commercial suppression; free/included entitlements rank first.
5. Amount/recurring/high-risk confirmation policies and family co-confirmation/代付 flow.
6. FakePaymentProvider with success, failure, unknown, cancellation, webhook replay and refund fixtures.
7. Transactional order/payment/fulfillment state machines, verified webhook handling and idempotency.
8. FulfillmentTask linked to WorkOrder where appropriate; provider/staff sees only minimum assigned data.
9. Rating, dispute, cancellation and refund flows.
10. ORDER/PAYMENT/REFUND/RECOMMENDATION events, notifications, timeline and analytics.
11. Negative authorization tests for family, finance, service operator and provider staff.
12. E2E Journey H including duplicate webhook and refund.

Constraints:
- No real payment integration or credentials.
- AI cannot directly pay, refund, subscribe or approve high-value service.
- Do not sell unreviewed medical, financial, supplement or fear-based products.
- Emergency/distress suppression must block paid recommendations.

Acceptance:
- Duplicate payment/refund events create no duplicate financial or fulfillment effects.
- UNKNOWN payment state is visible and cannot be treated as paid.
- Family co-confirmation and provider data minimization are enforced server-side.
- Journey H passes from reset seed data.
```

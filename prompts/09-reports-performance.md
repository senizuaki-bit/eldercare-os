# M09 — Dashboard, reports, ratings and transparent performance

```text
Execute M09 only.

Goal:
Implement decision-useful reporting and fair, explainable service metrics.

Deliver:
1. Aggregation jobs/materialized queries for dashboard and reports, with a documented metric registry/definition pattern that M12–M16 can extend without rewriting the dashboard framework.
2. Metrics: occupancy, active needs, work-order SLA, emergency response, device uptime/offline duration, category trends, AI correction rate, rating distribution, workload.
3. Dashboard prioritizing risk queues before analytics.
4. Filters by facility, time, floor/team and category.
5. Response time median and P90; avoid misleading averages alone.
6. Transparent performance score with configurable weights, component values, sample size, eligibility threshold and task-difficulty adjustment.
7. No public bottom ranking and no automatic disciplinary action.
8. CSV export with permission, audit and row-count limits.
9. Metric definition glossary and reconciliation tests against seed data; document extension points for content, activity, commerce and agent metrics but do not implement future modules early.
10. Loading/empty/error states and accessible charts with table alternatives.

Acceptance:
- Seed-data metrics reconcile exactly.
- Users can trace a metric to its definition and underlying filtered records where authorized.
- Score changes are explainable and versioned.
```

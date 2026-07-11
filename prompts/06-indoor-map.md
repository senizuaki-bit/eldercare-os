# M06 — Indoor floor map and privacy-safe location

```text
Execute M06 only.

Goal:
Show operationally useful floor/room/zone location with freshness and access control.

Deliver:
1. FloorPlan, map anchors, LocationSample and latest presence projection.
2. Upload/register SVG or PNG floor plan; store dimensions and normalized coordinates.
3. Location ingestion from simulator and manual room assignment fallback.
4. TTL/freshness service and current/stale/unknown states.
5. Admin map with filters for elders, active caregivers, devices and emergencies.
6. Emergency map mode: event location, nearest eligible caregiver candidates, room/zone text and timers.
7. Caregiver map limited to current task/facility context.
8. Family never receives caregiver location; elder location only according to sharing rules and appropriate granularity.
9. Active-shift-only caregiver location policy and audit.
10. LOCATION.SAMPLE_ACCEPTED/REJECTED/BECAME_STALE events and tests for stale samples, cross-facility data, expired shift, missing floor plan, coordinate bounds and stale-location dispatch degradation.

UX:
- Always show observed time and source.
- Stale locations appear gray with explicit text.
- Do not imply centimeter accuracy.

Acceptance:
- Fresh, stale and unknown states are visually and semantically distinct.
- Emergency assignment can use latest valid location but degrades safely when unavailable.
```

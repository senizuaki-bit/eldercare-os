# M02 — Facility, rooms, elders, family links, staff and shifts

```text
Execute M02 only.

Goal:
Build the operational directory and elder record foundation.

Deliver:
1. Building, Floor, Zone, Room, Bed, Elder, ElderStay, CareLevel, FamilyRelationship, EmergencyContact, AccessibilityProfile, PersonalBaseline, ConsentRecord foundation, StaffProfile, Team, Shift and ShiftAssignment models/migrations.
2. Bed occupancy constraints and admission/discharge history.
3. Elder list with search/filter/sort/pagination and detail tabs.
4. Room/bed management view inspired by the references but visually original.
5. Team and shift management with week view.
6. Family linking, field-level sharing preferences, communication/accessibility preferences and explicit personal-baseline source fields (elder stated, staff confirmed, inferred).
7. Caregiver assignment scopes tied to active shifts.
8. Fictional seed dataset described in docs/09-DEMO-ACCEPTANCE.md.
9. CRUD APIs with authorization, consent-aware field views, elder timeline foundation and audit.
10. Unit/integration/E2E tests, including overlapping stay prevention and unauthorized elder access.

UX:
- Dashboard links into filtered lists.
- Tables have loading/empty/error/forbidden states.
- Elder quick detail drawer shows only necessary summary; sensitive tabs require extra permission.
- Do not recreate the reference branding or exact forms.

Acceptance:
- Beds cannot have overlapping active stays.
- Family sees only linked elder summaries.
- Caregiver scope respects facility/floor/active shift.
- Seed/reset is repeatable.
```

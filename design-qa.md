# M02 Design QA

## Evidence

- Source visual truth path: `docs/design/m02-room-bed-direction.png`
- Primary implementation screenshot path: `docs/design/qa/m02-admin-rooms-1586x992.png`
- Full-view comparison evidence: `docs/design/qa/m02-room-comparison-1586x992.png`
- Additional implementation evidence:
  - `docs/design/qa/m02-admin-elders-1440x900.png`
  - `docs/design/qa/m02-admin-staff-1440x900.png`
  - `docs/design/qa/m02-admin-shifts-1440x900.png`
  - `docs/design/qa/m02-admin-contact-sheet.png`
  - `docs/design/qa/m02-mobile-contact-sheet.png`
- Viewport: room comparison `1586×992`; admin acceptance `1440×900` and `1280×900`; mobile acceptance `375×812` and `360×800`.
- State: authenticated fictional facility director on the loaded room/bed directory; authenticated elder, caregiver, and family sessions on their loaded home states.
- Browser-rendered evidence: project Chromium via the repository Playwright configuration. The in-app browser also verified the 1440×900 login composition and semantic labels; its local cross-port API policy prevented authenticated use, so authenticated screenshots and interactions use project Chromium.
- Focused-region comparison: no separate crop was needed. The combined comparison keeps both 1586×992 images at native scale, and the room headings, summary metrics, filters, status cards, bed rows, icons, typography, borders, and privacy copy remain legible. The post-fix shift and caregiver screens were additionally inspected at native resolution.

## Findings

No actionable P0, P1, or P2 finding remains.

- Typography: the implementation uses the existing Chinese system-font stack with clear 14 px admin content, stronger page/card hierarchy, and 18 px-or-larger elder primary content. Week-card titles now have enough width and no longer wrap one character per line. Mobile elder names are `h3` beneath their list-section `h2`.
- Spacing and layout rhythm: the room screen preserves the source direction—persistent teal navigation, compact top bar, breadcrumb/title/action row, four capacity summaries, filters, and a dense room-card grid—while remaining visually original. Vacant rooms now sort first and four cards fit across the reference frame. The week view intentionally uses a labelled horizontal scroll region plus an equivalent list view so each day remains scan-readable at 1440 and 1280 widths.
- Colors and tokens: restrained teal/blue surfaces, text-labelled status colors, light borders, and 10–12 px admin radii are consistent with the design system. The empty-shift text was moved from `#758395` to `--admin-text-secondary`, resolving the 3.86:1 Axe failure.
- Image quality and asset fidelity: the operational UI needs no raster product imagery. It uses the existing Ant Design icon family instead of emoji, CSS drawings, handwritten SVGs, or placeholder art. The generated room/bed direction image remains a design reference rather than a runtime asset.
- Copy and content: room cards explicitly avoid elder identity, family copy names withheld fields, caregiver copy names the active-shift boundary, elder-facing AI is disclosed as advisory, and all data is labelled as fictional or fixed demonstration content where relevant.
- Interactions and accessibility: real login, search, filters, column settings, pagination, quick detail, sensitive-access gate, room/staff/shift navigation, caregiver task progression, family privacy projection, and role denial were exercised. Axe reports no serious/critical violations after the contrast repair. Stable authenticated admin routes and all three mobile roles emitted no console errors or page errors; the expected unauthenticated session probe on the login screen returns 401 before login and was excluded from the post-auth console check.

## Open Questions

- The source direction includes a building tree and an enabled admission action. M02 intentionally ships a visually original four-filter directory and honest disabled create buttons because this milestone connects read management screens while CRUD is delivered at the authorized API layer. A guided admission UI remains future product work, not hidden functionality.
- The Next development toolbar was removed only from QA screenshots. No runtime product element was altered for capture.

## Comparison History

1. Initial capture was rejected as invalid evidence because elders, staff, shifts, and scoped mobile cards were photographed before data and Ant styles had settled. Capture scripts were changed to wait for real seeded records, computed styles, fonts, and stable hydration before taking screenshots.
2. First valid comparison found:
   - P1: caregiver elder cards preceded the priority task and pushed the main action below the fold.
   - P1: seven-day shift cards were too narrow and long names wrapped almost character-by-character.
   - P2: mobile elder-card titles flattened the heading hierarchy.
   - P2: the room grid hid available rooms below several tall full-room cards.
   - P2: empty-shift text failed WCAG AA contrast at 3.86:1.
3. Fixes made:
   - moved the priority task and its action above the caregiver roster;
   - widened the week grid, fixed the row-header/day column proportions, stacked status beneath the title, and retained keyboard-accessible horizontal scrolling plus list view;
   - changed elder-card names from `h2` to `h3`;
   - changed the room view to a four-column grid and availability-first ordering;
   - used the existing secondary text token for empty-shift copy.
4. Post-fix visual evidence:
   - `docs/design/qa/m02-mobile-caregiver-375x812.png`
   - `docs/design/qa/m02-mobile-caregiver-360x800.png`
   - `docs/design/qa/m02-admin-shifts-1440x900.png`
   - `docs/design/qa/m02-room-comparison-1586x992.png`
5. Post-fix automated evidence: full repository unit, lint, type, integration and production build gates passed; the complete admin/mobile E2E suite passed 12/12; production offline PWA passed 1/1; screenshot QA passed; stable admin and mobile console/page-error checks passed.

## Implementation Checklist

- [x] Source and implementation compared in one native-size combined image.
- [x] Desktop 1440/1280 and mobile 375/360 breakpoints checked.
- [x] Fonts, spacing, tokens, image/icon fidelity, copy, privacy, states, and accessibility reviewed.
- [x] All P1/P2 findings fixed and recaptured.
- [x] Console and page errors checked after authenticated hydration.
- [x] Evidence saved under `docs/design/qa/`.

## Follow-up Polish

- P3: a future admission-flow milestone can replace the disabled create affordances with a reviewed stepper once the full business workflow is in scope.
- P3: production telemetry can separately measure whether operators prefer the room vacancy-first default or a persisted personal sort.

final result: passed

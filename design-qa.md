# M00 Design QA

## Comparison target

- Source visual truth: `docs/design/m00-admin-dashboard-direction.png`
- Rendered implementation: `http://127.0.0.1:3000/`
- Primary implementation screenshot: `docs/design/qa/m00-admin-1487x1058.png`
- Comparison viewport: 1487 × 1058 bitmap-aligned content capture
- State: normal, local fictional fixture data, four risk rows visible, light theme
- Additional required viewports: admin 1440 × 900 and 1280 × 900; mobile 375 × 812 and 360 × 800

The written rules in `docs/01-UX-REFERENCE-SPEC.md` remain authoritative where the selected visual direction omits required controls or uses text smaller than the product minimum.

## Evidence

- Full-view side-by-side comparison: `docs/design/qa/m00-admin-comparison-1487x1058.png`
- Focused risk-ledger comparison: `docs/design/qa/m00-admin-table-comparison.png`
- Focused metric-strip comparison: `docs/design/qa/m00-admin-metrics-comparison.png`
- First-pass density evidence: `docs/design/qa/m00-admin-pass1-comparison.png`
- Admin responsive captures: `docs/design/qa/m00-admin-1440x900.png`, `docs/design/qa/m00-admin-1280x900.png`
- Mobile captures: `docs/design/qa/m00-mobile-375x812.png`, `docs/design/qa/m00-mobile-360x800.png`, `docs/design/qa/m00-mobile-family-360x800.png`
- Generated PWA icon inspected at native size: `apps/mobile-web/public/icons/icon-192.png`

Focused comparisons were required because table copy, icons, status colors, action affordances, and compact metric typography were not reliably readable in the full-width comparison alone.

## Findings

No actionable P0, P1, or P2 design differences remain.

The implementation intentionally adds a facility selector, global search, explicit demo-state controls, column visibility, filtering, sorting, and pagination. Those controls are absent from the visual direction but required by the written UX specification. The extra vertical space keeps critical queues ahead of decorative analytics and preserves the 14 px admin text minimum.

## Required fidelity surfaces

- Fonts and typography: the system CJK sans stack, weights, hierarchy, wrapping, and line heights preserve the reference's compact operational tone. Core admin text is at least 14 px; elder primary content is materially larger.
- Spacing and layout rhythm: navigation, page heading, risk ledger, and metrics retain the reference order and proportions. Card radii, borders, row dividers, and section gaps are consistent. Four default rows restore the reference ledger density.
- Colors and visual tokens: deep teal navigation, cool neutral surfaces, blue review state, red emergency state, amber overdue state, and restrained shadows map closely to the source and retain semantic contrast.
- Image quality and asset fidelity: visible UI icons use one consistent Ant Design icon family; no emoji, placeholder art, CSS drawings, handcrafted SVG, or fake imagery is used. The generated PWA icon remains sharp at 192 px and has adequate safe padding.
- Copy and content: fixture labels remain coherent and operational. Added AI, privacy, authorization, stale-data, and fictional-demo disclosures are intentional safety requirements.
- Icons and affordances: navigation, risk, table-sort, notification, state, and mobile action icons are aligned and consistent. Emergency and handoff actions remain visually distinct without relying on color alone.
- Responsiveness: no document-level horizontal overflow was observed at 1440 × 900, 1280 × 900, 375 × 812, or 360 × 800. The 360 px mobile shell reported zero controls below the 44 × 44 px touch minimum.
- Accessibility and motion: semantic headings, regions, labels, disabled states, reduced-motion rules, and a visible 2.4 px keyboard focus ring were verified. Elder voice and emergency actions exceed the 56 px critical-action minimum.

## Comparison history

### Pass 1 — blocked

- Earlier finding: **[P2] Risk-ledger density drift.** The implementation defaulted to two visible rows while the source showed all four risk categories. This moved the metric strip upward and weakened the intended all-risk scan.
- Evidence: `docs/design/qa/m00-admin-pass1-comparison.png`
- Fix: changed the default page size to four while retaining a working 2/4 page-size control and next-page behavior.

### Pass 2 — blocked

- Post-fix evidence: `docs/design/qa/m00-admin-comparison-1487x1058.png`
- The four-category ledger restored the intended hierarchy, but the automated accessibility sweep found a further **[P1] accessibility defect**: three unnamed progress bars, a prohibited ARIA label on the brand container, and four 14 px secondary-text colors below 4.5:1 contrast.
- Fix: added specific progress-bar names, removed the prohibited container label, and darkened the affected secondary text tokens.

### Pass 3 — passed

- Final evidence: `docs/design/qa/m00-admin-comparison-1487x1058.png`
- Focused evidence: `docs/design/qa/m00-admin-table-comparison.png` and `docs/design/qa/m00-admin-metrics-comparison.png`
- Result: both admin viewports now pass the serious/critical Axe gate, and the four-category ledger, metric strip, hierarchy, colors, typography, and interaction density preserve the selected direction within the written accessibility and table-control constraints.

## Browser validation

- Primary interactions tested: sidebar focus/collapse behavior, queue page-size switch, pagination to rows 3–4, local mobile role switching, family privacy filtering, and forbidden-state rendering.
- Console errors checked: none on admin or mobile.
- Mobile privacy check: no precise coordinates or caregiver-current-location field appeared; only the explicit notice that live location is hidden was present.
- Production offline check: after stopping the mobile server, the previously cached elder shell still reloaded. The in-app browser replaced an uncached-route navigation with its own native error surface, but the deterministic service-worker test and the production Chromium offline test both confirm that an uncached navigation resolves to the custom `/offline` page.

## Implementation checklist

- [x] Preserve risk-first hierarchy and all four default queue rows.
- [x] Keep required table controls usable without visual crowding.
- [x] Verify target desktop and mobile breakpoints.
- [x] Verify mobile privacy, explicit AI disclosure, and human handoff.
- [x] Verify keyboard focus, touch targets, state semantics, and console cleanliness.
- [x] Preserve one coherent icon and token system.

## Follow-up polish

The top bar is denser than the visual direction because it includes required search and facility context. This is an accepted product constraint, not an open fidelity defect.

final result: passed

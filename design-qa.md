# M03 Design QA

## Evidence

- Source visual direction: `docs/design/m03-elder-voice-request-direction.png`
- Source rationale: `docs/design/m03-elder-voice-request-direction.md`
- Same-state comparison: `docs/design/qa/m03-elder-voice-request-comparison.png` (reference left, implementation right)
- Final elder capture: `docs/design/qa/m03-elder-voice-request-375x812.png`
- Supporting captures:
  - `docs/design/qa/m03-admin-needs-1440x900.png`
  - `docs/design/qa/m03-admin-work-order-detail-1440x900.png`
  - `docs/design/qa/m03-caregiver-high-risk-checklist-375x812.png`
  - `docs/design/qa/m03-family-summary-360x800.png`

The in-app browser reported the responsive viewport independently of the saved image raster. Mobile browser chrome reduces the encoded capture area, so the filenames describe the verified browser viewport rather than the JPEG raster dimensions.

## Comparison Result

The elder implementation preserves the selected direction's calm teal/neutral palette, large single primary action, explicit AI identity, human-review boundary, human handoff, privacy explanation, and restrained bottom navigation. The final hierarchy puts “取消并返回” and “联系工作人员” immediately after the dominant request action, before the deterministic demo phrase, so an elder can exit or reach a person without scrolling.

The implementation intentionally says “提交演示语句” instead of pretending to record real audio. Success is shown only after the server confirms it. The deterministic “头晕” example says that staff and safety rules—not AI—decide escalation.

## Browser Verification

- Elder voice request at `375×812`: viewport measured in-page; primary action height `128px`; cancel and human-help actions each `69.6px`; no horizontal overflow; no console error or warning.
- Caregiver high-risk completion at `375×812`: the three server-owned checklist labels have approximately `48.2px` targets; the raw safety-rule code was replaced in the final tree by a readable Chinese product label with wrapping and a regression test.
- Family summary at `360×800`: privacy-filtered summary visible; no caregiver live location, coordinates, raw audio, transcript, or internal completion note; no horizontal overflow or console error.
- Admin need queue and work-order detail at `1440×900`: queue-before-analytics hierarchy, AI-advisory and deterministic-rule separation, immutable timeline, no horizontal overflow, and no console error.
- Keyboard/focus: the unique skip link targets `#main-content` and showed a `2.4px` visible focus outline.
- Automated Playwright coverage passed at admin `1440×900` and `1280×900`, plus mobile `375×812` and `360×800`; serious/critical Axe findings were empty.
- Production offline coverage passed and confirmed that protected portal content is not restored from cache.

## Accessibility and Safety Review

- Core admin text remains at least `14px`; elder primary content and critical controls use the larger mobile scale.
- Touch targets meet the `44px` baseline, and elder critical actions exceed `56px`.
- Risk and state use icon-plus-text labels rather than color alone.
- Elder-facing AI disclosure, exit, and human handoff are visible in the primary flow.
- Family output is consent-filtered and does not expose caregiver location.
- High-risk caregiver completion requires all server-owned checklist confirmations; the UI does not imply diagnosis or emergency closure.

## Scope

This pass covers the M03 product surfaces and primary journey: elder request, admin review/work order, caregiver response, family-safe summary, and elder-facing service review foundations. M04 emergency handling, M06 live location, M09 reporting, and later platform workflows remain intentionally out of scope.

final result: passed

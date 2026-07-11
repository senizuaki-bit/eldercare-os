# M12 — Content center, news playback and preferences

```text
Execute M12 only. M00–M11 must already be complete and green.

Goal:
Add a reviewed content/news pipeline that is safe for elder-facing playback and connected to consent, preferences, AI/TTS adapters, timeline, notifications and reporting.

Read first:
- docs/11-END-TO-END-FLOWS.md sections 12 and 18
- docs/12-CONTENT-ACTIVITY-COMMERCE.md sections 1–2
- docs/13-MULTI-AGENT-ORCHESTRATION.md ContentNewsAgent
- docs/14-EVENT-CATALOG.md content events
- docs/15-END-TO-END-ACCEPTANCE.md Journey F

Deliver:
1. ContentSource, ContentItem/version/review/schedule/playback/feedback/preference data model and migrations.
2. Content state machine with author/reviewer separation support.
3. Deterministic FakeContentSourceProvider and test fixtures; no live scraping required.
4. Admin content list, review, publish, retract and scheduling UI.
5. Elder mobile news/content experience with source, publication date, content type, sponsored label, play/pause/skip and preference feedback.
6. Provider-neutral summarizeContent and TTS integration using fake adapters by default.
7. Consent and quiet-hours enforcement; withdrawal stops future personalized playback.
8. Published-content-only tool/API for ContentNewsAgent; untrusted content cannot alter system instructions.
9. CONTENT.* outbox events, timeline references, notifications and analytics.
10. Loading/empty/error/offline/retracted states and accessible elder controls.
11. Unit, integration, negative authorization, prompt-injection fixture and E2E Journey F tests.

Constraints:
- Do not browse live news or include a production news API key.
- Never present unsourced content as news.
- Sponsored content cannot appear as emergency, public-safety or care guidance.
- Do not use health/emotion data for commercial content targeting.

Acceptance:
- Unreviewed/retracted content is never returned to elder playback.
- Source/date/sponsorship remain visible through summary and TTS flows.
- Preference and consent changes affect the next playback immediately.
- Journey F passes from a reset seed state.
```

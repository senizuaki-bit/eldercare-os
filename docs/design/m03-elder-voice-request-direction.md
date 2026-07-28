# M03 elder voice request visual direction

## Purpose

`m03-elder-voice-request-direction.png` is the single ImageGen design target for the M03 elder voice-request entry screen. It is documentation-only: the implementation must use project components, accessible text, explicit AI disclosure, human handoff and server-backed workflow state.

The direction keeps one dominant action and a calm, high-contrast hierarchy for an elder who wants to describe a need without navigating a form. It uses the accepted M02 mobile product language while borrowing only the task clarity—not the composition or copy—from the written voice-request reference.

## Generation

- Mode: built-in ImageGen
- Use case: `ui-mockup`
- Asset unit: one mobile elder voice-request screen
- Target: 390 × 844
- Date: 2026-07-21
- Style reference: `docs/design/qa/m02-mobile-elder-375x812.png`
- Workflow reference: `docs/references/04-mobile-complaint-and-repair.jpg`
- Reference role: hierarchy, accessibility and task framing only; no logo, portrait, brand, exact composition or proprietary copy was reused

## Final prompt

```text
Use case: ui-mockup
Asset type: one single 390×844 mobile elder-facing product screen
Input images: Image 1 is the accepted EldercareOS mobile visual language; preserve its calm deep-teal palette, warm neutral background, rounded white surfaces, large type and generous touch targets. Image 2 is workflow inspiration only; do not copy its brand, logo, exact composition, text, avatars or photography.
Primary request: design one focused Chinese eldercare voice-request screen for M03. The elder should immediately understand that an AI care assistant can help draft a request, that a human remains available, and that recording can be cancelled.
User outcome: submit a spoken daily-life request safely, or leave the AI flow and contact a person.
Composition/framing: full mobile product screenshot. Use a simple top bar with back navigation and the title “语音说需求”. Add a prominent disclosure card saying this is an AI care assistant and that staff will review the request. Make the single dominant action a large circular microphone control with the label “按住说话” and a clear recording-state explanation. Include the deterministic demo phrase “我想喝热水，今天有点头晕。”. Place explicit secondary actions for “取消” and “联系工作人员” within easy reach. Add a short privacy note that audio is used only for this service request and follows consent. Keep bottom navigation restrained and subordinate.
Style/medium: realistic, shippable mobile PWA UI—not concept art and not a wireframe.
Color palette: deep teal, cool white and warm neutral; amber only for a written safety notice. Use flat project tokens.
Accessibility: elder primary text visually at least 18px; critical action at least 56px; ordinary controls at least 44px; strong contrast; icon plus text for every status; obvious focus; no meaning conveyed by color alone.
Constraints: one screen only; one dominant action; original composition; no photo, portrait, copied brand, watermark, diagnosis, medication advice, hidden persuasion, fake success, glass effect, tiny text or clipped content.
```

## Implementation constraints

- Treat the generated image as hierarchy and interaction guidance, not executable UI or a source of product facts.
- Use flat project tokens even where the generated direction contains slight surface texture.
- Add an explicit text-labelled cancel/end control; the generated back arrow alone is insufficient.
- Always identify the assistant as AI, make staff handoff visible, and never claim success until the server confirms creation of the auditable request.
- The phrase about dizziness must trigger deterministic priority and human review, not an AI emergency decision or diagnosis.
- Preserve the full upload, processing, manual-review, success, failure, cancelled and offline states in the implementation.

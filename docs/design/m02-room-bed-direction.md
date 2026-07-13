# M02 room and bed management visual direction

## Purpose

`m02-room-bed-direction.png` is the single ImageGen design target for the M02 room and bed management screen. It is documentation-only: the implementation must use real Ant Design components, project tokens, accessible text and server-backed data.

The direction was selected because it preserves the accepted M00 shell while making occupancy, vacancy and unavailable capacity readable before administrative actions. It deliberately excludes resident names from the room overview.

## Generation

- Mode: built-in ImageGen
- Use case: `ui-mockup`
- Asset unit: one desktop administration screen
- Target: 1440 × 900
- Date: 2026-07-13
- Style reference: `docs/design/qa/m00-admin-1440x900.png`
- Reference role: style and product-system grounding only; the M00 risk queue was not an edit target

## Final prompt

```text
Use case: ui-mockup
Asset type: one single 1440×900 desktop administration screen visual direction
Input images: Image 1 is a style and product-system reference only. Preserve its deep-teal navigation rail, cool neutral surfaces, compact white top bar, restrained blue/teal accents, white cards, dark blue-gray typography, 8px spacing rhythm, 10–12px radii, enterprise density, and visible focus/status language. Do not copy its risk queue content or exact composition.
Primary request: create one focused Chinese eldercare operations screen for M02 room and bed occupancy management, used by a facility director or nursing supervisor.
User outcome: understand building/floor capacity, see which beds are occupied, vacant, or unavailable, and start a safe admission flow.
Composition/framing: full desktop product screenshot at 1440×900. Keep the established persistent sidebar and top bar. In the content workspace show breadcrumb “老人与入住 / 房间床位”, title “房间与床位”, a short operational description, secondary “刷新” action, and primary “办理入住” action. Place four compact occupancy summary cards before the main view: “总床位 20”, “已入住 12”, “空闲 6”, “停用 2”. Add a practical filter row for building, floor, occupancy status, and room/bed search. Main area should be an original room-and-bed management layout: a compact building/floor selector and a spacious grid of room cards. Each room card shows room code/type and individual bed rows with status icon + text + explanation, for example “B204 · 双人间”, “B204-1 已入住”, “B204-2 空闲”. Do not show resident names or sensitive details in the overview.
Style/medium: realistic shippable enterprise product UI, not concept art, not a wireframe.
Color palette: match the existing deep teal, cool gray-white, stable blue, limited amber/red only for exceptions.
Text: render only the specified Chinese interface labels where practical; do not invent branding or personal names.
Accessibility: core admin text visually at least 14px; status never communicated by color alone; strong contrast; generous 48–56px rows; obvious keyboard focus treatment.
Constraints: one screen only; practical controls; original information composition; no copied logo, brand, avatar, portrait, photo, watermark, proprietary copy, medical diagnosis language, decorative charts, gradients, glass effects, tiny text, clipped content, or fake map.
```

## Implementation constraints

- Treat the generated image as hierarchy and density guidance, not as executable UI or a source of exact text.
- Use icon + label + explanation for occupied, empty, reserved, maintenance and unavailable states.
- Derive occupancy from active stays; do not persist a separate `isOccupied` truth.
- Keep resident identity out of the room overview unless the viewer has explicit elder access.
- Do not introduce the generated header date, fictional counts or generated navigation copy as product facts.

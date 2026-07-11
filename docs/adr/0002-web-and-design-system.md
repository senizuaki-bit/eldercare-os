# ADR 0002: Web shells and design direction

- Status: Accepted
- Date: 2026-07-11

## Decision

Use Next.js 16.2.10 and React 19.2.7 for both web surfaces. The admin shell uses Ant Design 6.5.0, Ant Design Icons 6.3.2 and ECharts 6.1.0. Mobile uses the same icon language with project-owned responsive CSS and PWA metadata.

The M00 visual source is `docs/design/m00-admin-dashboard-direction.png`. It establishes a deep-teal navigation rail, cool neutral surfaces, risk-first ledger, compact operational metrics and strong focus treatment. The mobile shell inherits the same tokens but follows role-specific hierarchy from the written UX specification.

## Accessibility constraints

- Admin core text is at least 14px.
- Elder primary content is at least 18px.
- General touch targets are at least 44px; elder critical actions are at least 56px.
- Risk always has icon, label and explanation, never color alone.
- Loading, empty, error, offline, forbidden and stale states are visible and testable.
- Reduced-motion preferences disable non-essential animation.

## Asset policy

The supplied screenshots are inspiration only. No logos, names, portraits, watermarks, proprietary copy or exact layouts are reused. Standard UI icons come from Ant Design Icons; no handcrafted SVG, emoji or CSS-drawn substitutes are used.

## Rollback

Revert the shell files and shared UI package. The generated design source is documentation-only and can be removed with the M00 branch.

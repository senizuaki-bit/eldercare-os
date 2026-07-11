# M00 — Foundation and design system

```text
Read AGENTS.md and every file under docs/. Execute M00 only.

Goal:
Create a runnable TypeScript monorepo foundation and a cohesive visual shell. Do not implement business workflows yet.

Required outputs:
1. pnpm workspace and Turborepo.
2. apps/admin-web, mobile-web, api, worker, iot-simulator.
3. packages/db, contracts, ui, authz, ai, agents, events, content, commerce, config, observability. The extension packages may contain contracts/placeholders only; do not implement M12–M16 business behavior.
4. Docker Compose: PostgreSQL, Redis, MinIO, Mosquitto, optional mail catcher.
5. typed config and .env.example; no secrets.
6. root scripts and developer README.
7. API health/readiness and worker readiness.
8. CI: install, lint, typecheck, unit test, build.
9. smoke tests.
10. design tokens and shared primitives based on docs/01-UX-REFERENCE-SPEC.md.
11. admin shell: left navigation, top bar, breadcrumb, placeholder dashboard layout with meaningful non-production fixture cards. Navigation may reserve grouped entries for content, activities, services/orders and agents/approvals, but routes may remain disabled/placeholders until their milestone.
12. mobile shell: role selector for local demo, bottom navigation, elder/caregiver/family shell pages.
13. ADRs for framework/version choices.

Visual constraints:
- Reference images under docs/references are inspiration only.
- Do not copy brands, text, names, photos or exact layouts.
- Admin must be usable at 1280 and 1440 widths.
- Mobile must work at 360x800 and 375x812.
- Include loading, empty and error primitives.
- Include accessible focus and contrast.

Process:
- First inspect and present a file-by-file plan, dependencies, risks, tests and rollback. Wait for approval.
- Implement only after approval.
- Run install, lint, typecheck, tests and build.
- Verify health endpoints and app shells if environment permits.
- Update docs/TASK_STATUS.md.
```

Acceptance:
- New developer can start the stack using documented commands.
- All apps compile and render shells.
- CI is green.
- No business data model beyond infrastructure essentials; future-domain package placeholders do not count as implementing later milestones.

# Task status

| Milestone | Status | Branch | Acceptance | Notes |
|---|---|---|---|---|
| M00 Foundation | COMPLETE | feat/m00-foundation | passed | 2026-07-11; local milestone commit, no Git remote/PR configured |
| M01 Auth/RBAC | COMPLETE | feat/m01-auth-rbac | passed | 2026-07-13; local milestone accepted, GitHub publish pending remote/CLI setup |
| M02 Elder management | COMPLETE | feat/m02-elder-management | passed | 2026-07-21; automated, security, accessibility, browser and design acceptance passed; milestone PR published from this branch |
| M03 Needs/work orders | NOT_STARTED | feat/m03-needs-workorders | pending | |
| M04 Emergency | NOT_STARTED | feat/m04-emergency | pending | |
| M05 IoT/offline | NOT_STARTED | feat/m05-iot-offline | pending | |
| M06 Indoor map | NOT_STARTED | feat/m06-indoor-map | pending | |
| M07 AI pipeline | NOT_STARTED | feat/m07-ai-pipeline | pending | |
| M08 Mobile portals | NOT_STARTED | feat/m08-mobile-portals | pending | |
| M09 Reports/performance | NOT_STARTED | feat/m09-reports-performance | pending | |
| M10 Security/compliance | NOT_STARTED | feat/m10-security-compliance | pending | |
| M11 Core release/demo | NOT_STARTED | feat/m11-release-demo | pending | core MVP checkpoint |
| M12 Content/news | NOT_STARTED | feat/m12-content-news | pending | requires M11 |
| M13 Activities/interests | NOT_STARTED | feat/m13-activities-interests | pending | requires M12 |
| M14 Services/commerce | NOT_STARTED | feat/m14-services-commerce | pending | requires M13 |
| M15 Agent orchestration | NOT_STARTED | feat/m15-agent-orchestration | pending | requires M14 |
| M16 End-to-end integration | NOT_STARTED | feat/m16-end-to-end-integration | pending | journeys A–J |

## Status values

- NOT_STARTED
- PLANNING
- IN_PROGRESS
- BLOCKED
- IN_REVIEW
- COMPLETE

Do not mark a milestone COMPLETE if its automated acceptance, negative authorization tests, migrations or documentation are missing.

## Update format

For each completed milestone record:

- commit/PR
- migrations and rollback
- APIs/events/state machines
- permissions/consents/approvals
- commands run and exact result
- screenshots or route list
- journey/test mapping
- known limitations
- next milestone prerequisites

## M00 completion record

- Commit/PR: branch `feat/m00-foundation`; milestone commit subject `feat(m00): build runnable eldercare foundation`; no PR was opened because the repository has no Git remote.
- Migrations and rollback: `20260711000000_foundation_system_metadata` creates only `_system_metadata`; `rollback.sql` is included. Migrate, repeat migrate, repeat seed, reset, and seed-after-reset all passed against local PostgreSQL.
- APIs/events/state machines: API `/health/live`, `/health/ready`, `/docs`, and `/openapi.json`; worker live/readiness server; versioned MQTT base contracts. No business API, event consumer, or care state machine was implemented early.
- Permissions/consents/approvals: authorization, AI, agents, content, events, and commerce packages contain contracts/placeholders only. No M00 business data can be authorized or executed; UI role switching is explicitly local and not authentication.
- Commands and exact result:
  - `pnpm install --frozen-lockfile` — passed for all 17 workspace projects.
  - `pnpm lint` — 20/20 Turbo tasks passed plus root E2E/scripts lint.
  - `pnpm typecheck` — root TypeScript check plus 20/20 Turbo tasks passed.
  - `pnpm test` — 20/20 Turbo tasks passed; admin 7/7, mobile 11/11, and all API/worker/package unit suites passed.
  - `pnpm build` — 16/16 workspace builds passed; both Next.js production builds rendered their route manifests.
  - `pnpm test:integration` — 20/20 tasks passed against real PostgreSQL, Redis, and Mosquitto; OpenAPI concrete schemas passed.
  - `pnpm test:e2e` — 8/8 admin/mobile dual-viewport tests passed, including serious/critical Axe checks.
  - `pnpm test:e2e:offline` — 1/1 production service-worker test passed for cached-shell and uncached-route fallback behavior.
  - `pnpm compose:validate`, `pnpm security:scan`, MQTT check, and `pnpm smoke:services` — passed; PostgreSQL, Redis, MinIO, and Mosquitto reported healthy.
- Screenshots/routes: admin `/`; mobile `/m/elder/home`, `/m/caregiver/home`, `/m/family/home`, `/offline`; QA evidence under `docs/design/qa/`; final report `design-qa.md`; generated PWA icon under `apps/mobile-web/public/icons/`.
- Journey/test mapping: M00 validates only runnable shells, infrastructure, health boundaries, state primitives, responsive/accessibility behavior, local role previews, and offline degradation. End-to-end journeys A–J remain intentionally unimplemented.
- Known limitations: all visible records are fictional fixtures; there is no real auth, tenant data, care workflow, AI provider call, payment, device publishing, or production deployment. Local Compose credentials and anonymous MQTT are loopback-only development settings.
- Next milestone prerequisites: create `feat/m01-auth-rbac` from the accepted M00 branch, then implement tenant-aware identity, sessions, permissions, scope enforcement, audit foundations, and negative authorization coverage without starting M02 work.

## M01 completion record

- Commit/PR: branch `feat/m01-auth-rbac`; milestone commit subject `feat(m01): add tenant-aware auth and RBAC`; GitHub push and draft PR remain pending because this checkout has no remote and GitHub CLI is not installed.
- Migrations and rollback: `20260712000000_auth_rbac` adds `Organization`, `Facility`, `User`, `PasswordCredential`, `Role`, `Permission`, `RolePermission`, `UserRole`, `DataScope`, `AuthSession`, and `AuditEvent`; `rollback.sql` is included. Migrate and seed each passed twice, and a clean reset replayed both M00/M01 migrations before a successful seed.
- APIs/events/state machines: `POST /auth/login`, `GET /auth/session`, `POST /auth/context`, `POST /auth/logout`; tenant/facility-scoped user list/detail/access replacement, role list/detail, and audit-event endpoints. M01 adds no care-domain state machine or asynchronous business event early.
- Permissions/consents/approvals: server-side permission checks for session, organization/facility, identity and audit reads plus access replacement; explicit platform/organization/facility/floor/care-team/assigned-elder/active-shift/linked-elder/own-record scope policies and resource-policy extension points. `ACTIVE_SHIFT` is time bounded. A facility manager cannot replace organization/platform access, and no UI hiding substitutes for API authorization.
- Audit and session safety: opaque cookie sessions, CSRF double-submit protection, strict CORS, Redis login throttling, idle/absolute TTL, version-based revocation after access changes, atomic context switching plus audit, append-only audit metadata, generic non-enumerating denials, and response/log redaction.
- Commands and exact result:
  - `pnpm install --frozen-lockfile` — passed for all 17 workspace projects with the pinned lockfile.
  - `pnpm lint` — root E2E/scripts lint plus 22/22 Turbo tasks passed.
  - `pnpm typecheck` — root TypeScript check plus 22/22 Turbo tasks passed.
  - `pnpm test` — 22/22 Turbo tasks passed; admin 28/28, mobile 36/36, API 14/14, authz 12/12, contracts 10/10 and DB 11/11 passed.
  - `pnpm test:integration` — 20/20 Turbo tasks passed; API 12/12 includes real PostgreSQL/Redis auth and authorization coverage.
  - `pnpm build` — 16/16 workspace builds passed; both Next.js apps produced production route manifests.
  - `pnpm test:e2e` — 8/8 tests passed at admin 1440/1280 and mobile 375/360 viewports, including real login/logout, scoped search, role mismatch denial, family privacy and serious/critical Axe checks.
  - `pnpm test:e2e:offline` — 1/1 production PWA test passed; protected portal content was not restored from cache while offline.
  - `pnpm db:migrate`, repeated migrate, repeated seed, `pnpm db:reset`, and seed after reset — passed against local PostgreSQL.
  - `pnpm compose:validate`, `pnpm security:scan`, `pnpm smoke:services`, and the MQTT readiness check — passed.
  - `pnpm dev` — admin, mobile, API and worker all became reachable in one root dev run while retaining file watching.
- Screenshots/routes: admin `/login`, `/`, `/users`, `/roles`, `/forbidden`; mobile `/login`, `/m/elder/home`, `/m/caregiver/home`, `/m/family/home`, `/offline`; Swagger `/docs`. In-app browser QA verified the 1440×900 admin login/dashboard/access flow and the 375×812 elder login/home flow, including 118 px voice and 103 px emergency targets, confirmation gates, no horizontal overflow and no console errors.
- Journey/test mapping: authentication and routing tests cover valid/invalid login, CSRF, logout, context switching, session invalidation, cross-organization/cross-facility indistinguishable denial, insufficient permission, facility-manager anti-escalation, audit redaction, protected mobile portals and offline cache denial. This is the access-control foundation for journeys A–J; no M02 elder or later business workflow is claimed complete.
- Known limitations: local-demo password authentication only; no external IdP, MFA, password recovery or production credential lifecycle. Admin role/access pages are read-first except the protected API replacement endpoint used by integration coverage. Mobile home content remains fictional shell data. Elder, family relationship, staff/team/shift business records and consent-aware domain views begin in M02.
- Next milestone prerequisites: publish the M01 branch and draft PR when a GitHub remote/CLI are available, then create `feat/m02-elder-management` from accepted M01 and implement facility/room/bed, elder/family, staff/team/shift, consent-aware views and their negative authorization tests without starting M03.

## M02 completion record

- Commit/PR: branch `feat/m02-elder-management`; milestone commit subject `feat(m02): add elder and facility operations foundation`; the accepted branch is published through its GitHub milestone PR.
- Migrations and rollback: `20260713000000_elder_management` adds facility directory, elder/admission/stay, family relationship, emergency contact, accessibility, communication preference, baseline, consent/sharing, staff/team/shift, assignment, timeline and transactional outbox models; `rollback.sql` is included. Migrate, repeat migrate, repeat seed, clean reset, and seed after reset passed against local PostgreSQL.
- APIs/events/state machines: contract-backed CRUD and paginated reads under organization/facility-scoped elder, directory and staffing route families; family and caregiver projections expose only authorized elder fields. M02 creates transactional `OutboxEvent` records for mutations but intentionally does not start the M03 work-order state machine or asynchronous publisher early.
- Permissions/consents/approvals: 16 M02 permissions cover elder, sensitive elder, facility directory, staff, team, shift, consent and relationship reads/writes. Backend guards combine permission, tenant/facility context, linked-elder, active-shift, team and assignment relationships; future-dated or revoked grants fail closed. Family sharing is a server-timestamped full replacement, an empty set revokes all fields, and sensitive reads are separately gated and audited.
- Commands and exact result:
  - `pnpm lint` — root E2E/scripts lint plus 22/22 Turbo tasks passed.
  - `pnpm typecheck` — root TypeScript check plus 22/22 Turbo tasks passed.
  - `pnpm test` — 22/22 Turbo tasks passed; admin 34/34, mobile 40/40, API 28/28, contracts 43/43, authz 23/23 and DB 25/25 passed.
  - `pnpm test:integration` — 20/20 Turbo tasks passed; API 28/28 includes 16/16 M02 contract, pagination, projection, mutation, idempotency and negative-authorization cases against real PostgreSQL and Redis.
  - `pnpm build` — 16/16 workspace builds passed; both Next.js applications produced their production route manifests.
  - `pnpm test:e2e` — 12/12 tests passed at admin 1440/1280 and mobile 375/360 viewports, covering scoped directories, elder/caregiver/family projections, privacy boundaries, role denial, responsive behavior and serious/critical Axe checks.
  - `pnpm test:e2e:offline` — 1/1 production PWA test passed; protected portal content was not restored from cache while offline.
  - `pnpm db:migrate`, repeated migrate, repeated seed, `pnpm db:reset`, and seed after reset — passed against local PostgreSQL.
  - `pnpm compose:validate`, `pnpm security:scan`, and `pnpm smoke:services` — passed; API and worker liveness/readiness were healthy.
- Screenshots/routes: admin `/elders`, `/facility/rooms`, `/staff`, `/shifts`; mobile `/m/elder/home`, `/m/caregiver/home`, `/m/family/home`; Swagger `/docs`. Native-size reference/implementation comparison, contact sheets and dual-viewport evidence are under `docs/design/qa/`; `design-qa.md` ends with `final result: passed`.
- Journey/test mapping: M02 supplies the organization/facility, room/bed, elder/family, staff/team/shift and consent-aware data foundation for journey A and later emergency, device, content, activity, commerce and agent journeys. It does not claim the M03 need-to-work-order workflow, M04 emergency flow or M10 compliance lifecycle complete.
- Known limitations: admin creation actions remain honest disabled affordances until a reviewed admission/staffing workflow is in scope; the directory UI is read-first while authorized CRUD is available through the API. Fake seed identities and local providers remain mandatory.
- Next milestone prerequisites: review and merge the M02 PR, then create `feat/m03-needs-workorders` from the accepted M02 line and implement the elder request, deterministic risk check, work-order lifecycle, caregiver response, family-safe summary, elder review and audit flow without starting M04 early.

# AGENTS.md

## Mission

Build a production-minded MVP for an eldercare operations system. Optimize for complete, auditable workflows rather than a large number of disconnected screens.

Primary workflow:

`elder voice request -> AI draft analysis -> deterministic risk check -> work order -> caregiver response -> family-safe summary -> elder review -> reporting`

Critical secondary workflows:

- `emergency signal -> location -> assignment -> escalation -> resolution -> review`
- `device heartbeat loss -> offline alert -> maintenance task -> fallback patrol -> stable recovery`
- `approved content -> personalized playback -> feedback -> preference update`
- `interest -> activity recommendation -> enrollment -> escort -> attendance -> feedback`
- `explicit need -> safe service recommendation -> confirmation/payment -> fulfillment -> review/refund`
- `user input -> agent routing -> restricted tool -> approval gate -> business result -> audit`

The complete operating model is defined in `docs/11-END-TO-END-FLOWS.md`. Core care is M00–M11; platform extensions are M12–M16.

## Source of truth

Before changing code, read:

1. `README-FIRST.md`
2. every file under `docs/`
3. the current milestone prompt under `prompts/`

The written UX specification in `docs/01-UX-REFERENCE-SPEC.md` is the source of truth. Images under `docs/references/` are inspiration only. Do not copy logos, names, watermarks, personal photos, exact screen compositions, or proprietary text.

## Delivery discipline

- Use a TypeScript monorepo with pnpm workspaces.
- One milestone equals one branch and one pull request.
- Before editing, inspect relevant files and present a concise implementation plan.
- Do not implement future milestones early.
- Do not perform unrelated refactors.
- Do not add production dependencies unless necessary and documented.
- Pin dependencies in the lockfile.
- Keep migrations and generated clients reproducible.
- Update `docs/TASK_STATUS.md` after every milestone.
- Update contracts, seed data, tests, OpenAPI, and docs when changing an API or schema.

## Target layout

```text
apps/
  admin-web/       # institution management console
  mobile-web/      # elder, caregiver, family role-based PWA
  api/             # NestJS REST/WebSocket API
  worker/          # queues, AI jobs, escalations, offline detection, reporting
  iot-simulator/   # MQTT heartbeat, telemetry, location, emergency simulator
packages/
  db/              # Prisma schema, migrations, seed
  contracts/       # API schemas/types and generated client
  ui/              # shared UI primitives and design tokens
  authz/           # permissions, policies, scopes
  ai/              # provider-neutral transcription/LLM/TTS adapters
  agents/          # registry, router, restricted tool gateway, approvals
  events/          # outbox, event envelope, idempotent consumers
  content/         # content/news source adapters and policies
  commerce/        # service catalog, order/payment abstractions
  config/          # typed environment configuration
  observability/   # logs, traces, metrics and redaction
infra/
  docker/
docs/
```

## Required root commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm dev
pnpm build
pnpm db:migrate
pnpm db:seed
pnpm db:reset
```

## Local infrastructure

Docker Compose must provide PostgreSQL, Redis, MinIO, Mosquitto MQTT, and optionally a mail catcher. The complete demo must work without paid keys by using deterministic fake providers.

## UX rules

### Admin console

- Desktop-first, target 1440×900 and usable from 1280 px wide.
- Persistent left navigation, compact top bar, breadcrumb, page title/action row.
- Light neutral background, white cards, restrained blue/teal accent, strong status colors.
- Use 12-column layout, consistent 8 px spacing scale, 10–12 px card radius.
- Tables must support search, filters, sorting, pagination, column visibility, loading, empty and error states.
- Critical queues must appear before decorative analytics.
- Never use color alone to communicate risk.

### Mobile PWA

- Mobile-first, target 375×812 and 360×800.
- Elder mode uses large text, large touch targets, one dominant action, clear AI disclosure and human handoff.
- Caregiver mode prioritizes urgent tasks, nearby work, route/room context and quick voice completion.
- Family mode prioritizes privacy-filtered summaries, events, service progress and communication drafts.
- Do not expose caregiver live location to family users.

### Accessibility

- Meet WCAG 2.2 AA where practical.
- Minimum touch target 44×44 px; elder critical actions 56 px or larger.
- Visible focus, keyboard navigation, semantic labels, sufficient contrast, reduced-motion support.
- Do not use text smaller than 14 px for core admin content or 18 px for elder primary content.

## Multi-tenancy and authorization

- Every business record belongs to an organization and, where applicable, a facility.
- Never trust organization, facility, elder or user IDs supplied by a client without access checks.
- Enforce authorization in API/service code, not only in the UI.
- Combine role permissions, data scopes, resource relationships and time-bound emergency elevation.
- Family users access only linked elders and privacy-filtered fields.
- Caregivers access only assigned facility/floor/elder scopes for active shifts, except audited emergency elevation.
- Add negative authorization tests for every sensitive module.

## Sensitive data

- Never log medical, emotional, voice or location content together with direct identity.
- Never log tokens, passwords, secrets, raw audio, full transcripts or precise coordinates.
- Use fictional seed data only.
- Commit only `.env.example`, never real secrets.
- Use short-lived signed object URLs and validate upload type/size.
- Add retention metadata for audio, transcripts, location and AI observations.
- Provide consent, withdrawal, access audit, export and deletion foundations.

## AI safety

- AI output is advisory and schema-validated.
- Deterministic rules and/or a human decide emergency escalation; an LLM is never the sole decision maker.
- Emotion analysis is a trend observation, never diagnosis.
- Store evidence, confidence, provider/model, prompt version, schema version and reviewer correction.
- Do not claim depression, dementia, incapacity or disease.
- Do not recommend medication changes or diagnoses.
- Family communication assistance creates a reviewable draft; it must not secretly manipulate, impersonate, coerce or bypass refusal.
- Elder-facing AI must disclose it is AI, allow exit and provide human handoff.
- Elder data is not used for training by default.
- All local and automated tests use fake AI unless explicitly marked integration-only.

## State machines

Work order:

`NEW -> ASSIGNED -> ACCEPTED -> IN_PROGRESS -> COMPLETED -> VERIFIED -> CLOSED`

Emergency:

`OPEN -> ACKNOWLEDGED -> RESPONDING -> RESOLVED -> REVIEWED`

Device alert:

`ACTIVE -> ACKNOWLEDGED -> MAINTENANCE -> RECOVERED -> CLOSED`

Transitions are validated server-side and audited with actor, timestamp and reason. Jobs and device events must be idempotent.

## Device and location rules

- Use provider-neutral adapters and versioned MQTT topics/payloads.
- Offline alerts close only after stable recovery.
- Critical device offline events create a fallback patrol task.
- Location samples require source, timestamp, accuracy and TTL.
- Stale location must display stale/unknown, never current.
- Caregiver location collection is limited to active shift and facility context.

## Content, activities and commerce

- External content is untrusted and must be reviewed before elder-facing playback.
- News must retain source and publication date; sponsored content must be labeled.
- Activity recommendations are explainable, optional and capacity-safe.
- Commercial recommendations must never exploit emergency, distress, cognitive vulnerability or family conflict.
- Free/included entitlements and suitability outrank commission.
- High-value, recurring or high-risk services require explicit confirmation/approval.
- Use FakePaymentProvider until a separately reviewed real payment milestone.
- Payment, refund, enrollment and agent tool calls must be idempotent.

## Multi-agent rules

- Present one unified AI entry point; route internally by identity, intent, risk and consent.
- Agents never receive database credentials, arbitrary SQL, shell or unrestricted network tools.
- Every tool has schema, permissions, consents, risk level and approval policy.
- Emergency/health concerns outrank activity and commerce intents.
- Do not persist unnecessary hidden reasoning; persist audit-safe summaries, tool calls, policy decisions and business results.
- AI cannot directly pay, refund, diagnose, close emergencies, punish staff or secretly persuade an elder.

## Ratings and performance

- Score formulas are transparent and configurable.
- Show components, sample sizes and confidence/eligibility.
- No automatic disciplinary actions.
- No public bottom-ranked list.
- Apply minimum sample thresholds and task-difficulty adjustment.

## Testing

Each feature requires unit tests, API integration tests, negative authorization tests and relevant E2E coverage. Add idempotency tests for jobs/events. AI tests are fixture-based and never call external providers.

## Review priorities

Treat these as blockers:

- cross-tenant exposure
- missing backend authorization
- secrets or sensitive data in logs
- unaudited emergency changes
- non-idempotent alerts/escalations
- AI making final medical/emergency decisions
- stale location shown as live
- retention without deletion path
- coercive or hidden elder-facing AI
- destructive migration without rollback
- inaccessible elder critical actions
- unreviewed external content shown to elders
- commercial recommendation during emergency/distress suppression
- payment or refund without idempotency and verified state
- agent tool execution without permission/consent/approval

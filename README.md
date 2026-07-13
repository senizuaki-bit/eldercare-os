# Eldercare OS

Production-minded eldercare operations MVP, built milestone by milestone. Through M01 the repository provides a runnable monorepo, local infrastructure, real local-demo password sessions, tenant-aware RBAC/data scopes, audit foundations, protected admin pages, and role-derived mobile portals. Elder and care-domain records remain intentionally deferred to M02 and later milestones.

## Prerequisites

- Node.js 24.16 or newer in the Node 24 line
- Corepack and pnpm 11.11.0
- Docker Desktop or another Docker Engine with Compose

Enable the pinned package manager once:

```bash
corepack enable
corepack prepare pnpm@11.11.0 --activate
```

If your machine does not allow Corepack to write global shims, replace `pnpm` with `corepack pnpm` in the commands below.

## Start locally

```bash
cp .env.example .env
pnpm install
docker compose up -d --wait
pnpm storage:init
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Windows PowerShell equivalent for the first command:

```powershell
Copy-Item .env.example .env
```

Open:

- Admin console: <http://127.0.0.1:3000>
- Mobile PWA: <http://127.0.0.1:3001>
- API docs: <http://127.0.0.1:4000/docs>
- API liveness: <http://127.0.0.1:4000/health/live>
- API readiness: <http://127.0.0.1:4000/health/ready>
- Worker liveness: <http://127.0.0.1:4001/health/live>
- Worker readiness: <http://127.0.0.1:4001/health/ready>
- MinIO console: <http://127.0.0.1:9001>

### Fictional local demo accounts

All seven accounts use `LocalDemoOnly!2026` unless `M01_DEMO_PASSWORD` is changed before seeding.

| Account | Role | Suggested use |
|---|---|---|
| `platform.admin` | Platform administrator | platform-scope API checks |
| `facility.director` | Facility director | admin console demo |
| `nursing.supervisor` | Nursing supervisor | scoped admin/API checks |
| `caregiver.demo` | Caregiver | caregiver mobile portal |
| `device.manager` | Device manager | cross-facility denial checks |
| `elder.demo` | Elder | elder mobile portal |
| `family.demo` | Family | privacy-filtered family portal |

Demo seeding is denied unless `NODE_ENV` is `development` or `test` **and** `ELDERCARE_ALLOW_DEMO_SEED=true`. The committed `.env.example` opts in only for a local demo; never reuse its credentials or opt-in in a shared or production environment.

All visible people, counts, rooms, queues and service events are fictional fixtures. Mobile portal selection comes only from the server-authorized session; there is no client-side role switch.

Primary routes:

- Admin: `/login`, `/`, `/users`, `/roles`, `/forbidden`
- Mobile: `/login`, `/m/elder/home`, `/m/caregiver/home`, `/m/family/home`, `/offline`
- API: `/docs`, `/openapi.json`, `/health/live`, `/health/ready`

The Compose stack is for local development only. Its published ports bind to `127.0.0.1`, and the committed development credentials must never be reused outside this machine.

## Root commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
pnpm dev
pnpm db:migrate
pnpm db:seed
pnpm db:reset
```

Additional foundation checks:

```bash
pnpm compose:validate
pnpm security:scan
pnpm test:e2e:offline
pnpm --filter @eldercare/iot-simulator dry-run
pnpm --filter @eldercare/iot-simulator check
pnpm smoke:services
```

`test:integration` and `smoke:services` expect local infrastructure to be running; the service smoke also expects a completed build. `test:e2e` starts the API plus both Next.js apps and exercises real cookie sessions at the required desktop/mobile viewports. `test:e2e:offline` expects a production build and verifies that protected portal data is never restored from the service-worker cache.

## Workspace

```text
apps/
  admin-web/       protected institution console and read-first access directory
  mobile-web/      session-derived elder, caregiver and family PWA portals
  api/             NestJS auth, scoped identity/audit APIs, health and OpenAPI
  worker/          readiness server; business jobs begin in later milestones
  iot-simulator/   MQTT connection-only skeleton
packages/
  db/              Prisma M00 metadata plus M01 identity/session/audit schema
  contracts/       health, error, auth, identity, audit and MQTT schemas
  ui/              shared design tokens and state primitives
  authz/            permissions, roles, data-scope and resource policies
  ai/               provider contracts only
  agents/           restricted-tool contracts only
  events/           event-envelope contracts only
  content/          source-provider contracts only
  commerce/         payment-provider contracts only
  config/           typed environment configuration
  observability/    safe structured logging and redaction
```

## Health semantics

- `/health/live` answers whether the process is running. It stays `200` if a dependency is down.
- `/health/ready` checks required dependencies and returns `503` when the process should not receive work.
- Health responses expose check names and state only. They never return connection strings, credentials or stack traces.

## Database lifecycle

M00 creates `_system_metadata`. M01 adds `Organization`, `Facility`, `User`, `PasswordCredential`, `Role`, `Permission`, `RolePermission`, `UserRole`, `DataScope`, `AuthSession`, and append-only `AuditEvent` storage. Elder, work-order, emergency, device, content, activity and commerce tables remain deferred to their own milestones.

To reset the local development database:

```bash
pnpm db:reset
pnpm db:seed
pnpm storage:init
```

Each applied milestone migration folder contains a reviewed `rollback.sql`. Do not run rollback SQL against an environment with later migrations applied.

## Stop services

```bash
docker compose down
```

This preserves named volumes. Use `docker compose down -v` only when you explicitly want to delete all local infrastructure data.

## Troubleshooting

- `pnpm` not found: use `corepack pnpm` or enable Corepack from an elevated terminal.
- readiness is `503`: run `docker compose ps` and inspect the named failed check; the response intentionally omits endpoints and secrets.
- login reports unavailable: use one of the configured `CORS_ORIGINS` exactly; `.env.example` permits both `127.0.0.1` and `localhost` for ports 3000 and 3001.
- MQTT check fails: confirm the `mosquitto` service is healthy and port `1883` is free.
- browser shell starts but looks unstyled: rebuild workspace packages, then restart `pnpm dev`.

Product boundaries and milestone order are defined in [README-FIRST.md](README-FIRST.md) and [docs/TASK_STATUS.md](docs/TASK_STATUS.md).

# Eldercare OS

Production-minded eldercare operations MVP, built milestone by milestone. M00 provides the runnable monorepo, local infrastructure, health boundaries and visual shells; it intentionally does not implement care workflows yet.

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

- Admin shell: <http://127.0.0.1:3000>
- Mobile shell: <http://127.0.0.1:3001>
- API docs: <http://127.0.0.1:4000/docs>
- API liveness: <http://127.0.0.1:4000/health/live>
- API readiness: <http://127.0.0.1:4000/health/ready>
- Worker liveness: <http://127.0.0.1:4001/health/live>
- Worker readiness: <http://127.0.0.1:4001/health/ready>
- MinIO console: <http://127.0.0.1:9001>

All visible people, counts, rooms, queues and service events in M00 are fictional fixtures. The mobile role switch changes only local UI and is not authentication or authorization.

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

`test:integration` and `smoke:services` expect local infrastructure to be running; the service smoke also expects a completed build. `test:e2e` starts the two Next.js development shells automatically, while `test:e2e:offline` expects a production build and verifies service-worker recovery.

## Workspace

```text
apps/
  admin-web/       desktop institution shell
  mobile-web/      elder, caregiver and family PWA shells
  api/             NestJS health/OpenAPI foundation
  worker/          readiness server; no business jobs in M00
  iot-simulator/   MQTT connection-only skeleton
packages/
  db/              Prisma infrastructure metadata only
  contracts/       health, error and MQTT base schemas
  ui/              shared design tokens and state primitives
  authz/            authorization type boundary only
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

M00 creates only `_system_metadata`, an infrastructure marker used to prove that migrations and the deterministic seed are reproducible. No organization, elder, work-order, emergency or other future-domain table is introduced early.

To reset the local development database:

```bash
pnpm db:reset
pnpm db:seed
pnpm storage:init
```

The migration folder contains `rollback.sql` for explicit M00 rollback review. Do not run rollback SQL against an environment with later milestones applied.

## Stop services

```bash
docker compose down
```

This preserves named volumes. Use `docker compose down -v` only when you explicitly want to delete all local infrastructure data.

## Troubleshooting

- `pnpm` not found: use `corepack pnpm` or enable Corepack from an elevated terminal.
- readiness is `503`: run `docker compose ps` and inspect the named failed check; the response intentionally omits endpoints and secrets.
- MQTT check fails: confirm the `mosquitto` service is healthy and port `1883` is free.
- browser shell starts but looks unstyled: rebuild workspace packages, then restart `pnpm dev`.

Product boundaries and milestone order are defined in [README-FIRST.md](README-FIRST.md) and [docs/TASK_STATUS.md](docs/TASK_STATUS.md).

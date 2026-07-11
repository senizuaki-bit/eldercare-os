# ADR 0003: Backend, database and local infrastructure

- Status: Accepted
- Date: 2026-07-11

## Decision

Use NestJS 11 for the API, a separate Node worker process, Prisma 7 with the PostgreSQL driver adapter, PostgreSQL, Redis, MinIO and Mosquitto.

M00 exposes liveness/readiness and OpenAPI only. The worker has no business consumers, and the IoT simulator connects without publishing domain events. Prisma contains one `_system_metadata` infrastructure table so migrate/seed/reset are real and repeatable without implementing a future domain early.

## Boundaries

- PostgreSQL will be the system of record; Redis is never a business fact source.
- Server configuration is parsed once from environment variables and fails closed.
- Browser configuration exports only explicitly public values.
- Readiness responses contain check names and status, not endpoints, credentials or errors.
- Future AI, content, payment, agent and event packages contain contracts only in M00.

## Rollback

Use the migration `rollback.sql` only for an isolated M00 database, or delete the local Compose volume. Later milestones must use forward migrations rather than applying this rollback destructively.

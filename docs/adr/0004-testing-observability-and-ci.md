# ADR 0004: Testing, observability and CI baseline

- Status: Accepted
- Date: 2026-07-11

## Decision

Use Vitest for package/application tests, Supertest for API HTTP integration, Playwright for viewport and interaction smoke tests, and GitHub Actions for frozen install, lint, typecheck, unit, integration, browser smoke and build.

Safe structured logging accepts a small audit-safe context and recursively redacts denylisted keys. Correlation IDs are validated or generated at the API boundary. Neither health responses nor errors expose stacks, URLs or secrets.

## Verification policy

A command passing is evidence only for what it actually covers. M00 completion additionally requires:

- the two web shells rendered in a browser at their specified viewports;
- API and worker live/ready behavior verified in healthy and degraded states;
- Compose configuration validated and, where an engine is available, services started healthy;
- repository secret-pattern scan passing;
- visual comparison against the selected design recorded in `design-qa.md`.

## Rollback

CI and test files are branch-local and can be reverted. Test failures must not be removed or weakened to make a milestone appear complete.

# ADR 0001: Node, pnpm and Turborepo foundation

- Status: Accepted
- Date: 2026-07-11

## Decision

Use Node 24.16.0, pnpm 11.11.0 workspaces, TypeScript 6.0.3 and Turborepo 2.10.4. Package versions are exact in manifests and the lockfile.

Applications and packages remain in one repository. Turborepo coordinates build, lint, typecheck and test dependencies; pnpm owns installation and workspace linking.

## Why

The product needs several deployable processes but one transactional domain. A monorepo keeps contracts, configuration and design tokens aligned without introducing premature service boundaries.

TypeScript 6 is selected instead of TypeScript 7 because the current typed ESLint toolchain declares support through TypeScript 6.0. Exact versions make CI and local reproduction auditable.

## Consequences

- Developers must use the pinned pnpm release.
- Workspace packages build before production applications.
- Breaking framework upgrades require a new ADR and full root-command verification.

## Rollback

Revert the M00 commit/branch. No global tool installation is required when commands are run through Corepack.

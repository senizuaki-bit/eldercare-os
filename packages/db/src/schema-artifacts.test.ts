import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const migrationUrl = new URL(
  '../prisma/migrations/20260712000000_auth_rbac/migration.sql',
  import.meta.url,
);
const rollbackUrl = new URL(
  '../prisma/migrations/20260712000000_auth_rbac/rollback.sql',
  import.meta.url,
);
const seedUrl = new URL('../prisma/seed.ts', import.meta.url);

describe('M01 schema artifacts', () => {
  it('physically enforces tenant consistency without blocking multi-facility roles', async () => {
    const migration = await readFile(migrationUrl, 'utf8');

    expect(migration).toContain('data_scopes_user_role_id_organization_id_fkey');
    expect(migration).toContain('data_scopes_facility_id_organization_id_fkey');
    expect(migration).toContain('auth_sessions_facility_id_organization_id_fkey');
    expect(migration).toContain('audit_events_facility_id_organization_id_fkey');
    expect(migration).not.toContain('user_roles_active_assignment_key');
  });

  it('makes audit rows append-only and keeps the M00 metadata table out of rollback', async () => {
    const [migration, rollback] = await Promise.all([
      readFile(migrationUrl, 'utf8'),
      readFile(rollbackUrl, 'utf8'),
    ]);

    expect(migration).toContain('audit_events_append_only');
    expect(migration).toContain('BEFORE UPDATE OR DELETE');
    expect(migration).toContain('audit_events_prevent_truncate');
    expect(migration).toContain('BEFORE TRUNCATE');
    expect(rollback).not.toContain('DROP TABLE IF EXISTS "_system_metadata"');
    expect(rollback).toContain('DROP TABLE IF EXISTS "organizations"');
    expect(rollback).toContain('"schemaVersion":"1.0"');
    expect(rollback).toContain('"containsBusinessFixtures":false');
  });

  it('requires every active-shift scope to have a finite validity window', async () => {
    const [migration, seed] = await Promise.all([
      readFile(migrationUrl, 'utf8'),
      readFile(seedUrl, 'utf8'),
    ]);

    expect(migration).toContain(
      `"kind" = 'ACTIVE_SHIFT' AND "facility_id" IS NOT NULL AND "resource_type" IS NULL AND "resource_id" IS NULL AND "valid_until" IS NOT NULL`,
    );
    expect(seed).toContain('validFrom: demoShiftValidFrom');
    expect(seed).toContain('validUntil: demoShiftValidUntil');
  });
});

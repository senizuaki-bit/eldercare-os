import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const schemaUrl = new URL('../prisma/schema.prisma', import.meta.url);
const migrationUrl = new URL(
  '../prisma/migrations/20260721000000_needs_workorders/migration.sql',
  import.meta.url,
);
const rollbackUrl = new URL(
  '../prisma/migrations/20260721000000_needs_workorders/rollback.sql',
  import.meta.url,
);
const seedUrl = new URL('../prisma/seed.ts', import.meta.url);

describe('M03 needs and work-order database artifacts', () => {
  it('models the complete correlated workflow and exact state machine', async () => {
    const schema = await readFile(schemaUrl, 'utf8');
    for (const model of [
      'VoiceSubmission',
      'Transcript',
      'AIAnalysis',
      'Need',
      'NeedLink',
      'WorkOrder',
      'WorkOrderAssignment',
      'WorkOrderTransition',
      'WorkOrderArrival',
      'ServiceCompletion',
      'FamilySummary',
      'Rating',
    ]) {
      expect(schema).toContain(`model ${model} {`);
    }

    const statusBody = schema.match(/enum WorkOrderStatus \{([\s\S]*?)\}/)?.[1] ?? '';
    expect(statusBody.match(/[A-Z_]+/g)).toEqual([
      'NEW',
      'ASSIGNED',
      'ACCEPTED',
      'IN_PROGRESS',
      'COMPLETED',
      'VERIFIED',
      'CLOSED',
      'CANCELLED',
    ]);
    expect(statusBody).not.toContain('ARRIVED');
    expect(schema).toContain('arrivedAt');
  });

  it('pins tenancy, idempotency, retention and optimistic versions in the schema', async () => {
    const schema = await readFile(schemaUrl, 'utf8');
    expect(schema).toContain('@@unique([organizationId, idempotencyKey])');
    expect(schema).toContain('@@unique([id, elderId, organizationId, facilityId])');
    expect(schema).toContain('retentionUntil');
    expect(schema).toContain('objectDeletedAt');
    expect(schema).toContain('uploadObjectKey');
    expect(schema).toContain('uploadAuthorizedUntil');
    expect(schema).toContain('sealCandidateObjectKey');
    expect(schema).toContain('contentDeletedAt');
    expect(schema).toContain('completionChecklist');
    expect(schema).toContain('checklistConfirmedAt');
    expect(schema).toMatch(/model WorkOrder \{[\s\S]*?version\s+Int\s+@default\(1\)/);
    expect(schema).toMatch(/model WorkOrderArrival \{[\s\S]*?fromVersion[\s\S]*?toVersion/);
  });

  it('adds database-enforced transition, arrival and immutable-audit rules', async () => {
    const migration = await readFile(migrationUrl, 'utf8');
    expect(migration).toContain('work_order_assignments_one_active_key');
    expect(migration).toContain('WORK_ORDER_STATE_TRANSITION_INVALID');
    expect(migration).toContain('WORK_ORDER_ARRIVAL_INVALID');
    expect(migration).toContain('WORK_ORDER_TRANSITION_SNAPSHOT_MISMATCH');
    expect(migration).toContain('WORK_ORDER_ARRIVAL_SNAPSHOT_MISMATCH');
    expect(migration).toContain('work_order_transitions_immutable');
    expect(migration).toContain('work_order_arrivals_immutable');
    expect(migration).toContain('HEALTH_CONCERN');
    expect(migration).toContain('"score" BETWEEN 1 AND 5');
    expect(migration).toContain('"object_deleted_at" TIMESTAMPTZ(3)');
    expect(migration).toContain('"upload_object_key" VARCHAR(512)');
    expect(migration).toContain('"upload_authorized_until" TIMESTAMPTZ(3)');
    expect(migration).toContain('"seal_candidate_object_key" VARCHAR(512)');
    expect(migration).toContain('"seal_candidate_source_etag" VARCHAR(128)');
    expect(migration).toContain('"seal_lease_token" UUID');
    expect(migration).toContain('"seal_lease_until" TIMESTAMPTZ(3)');
    expect(migration).toContain('"object_deletion_pending_at" TIMESTAMPTZ(3)');
    expect(migration).toContain('"content_deleted_at" TIMESTAMPTZ(3)');
    expect(migration).toContain('"completion_checklist" JSONB NOT NULL');
    expect(migration).toContain('"checklist_confirmed_at" TIMESTAMPTZ(3)');
    expect(migration).toContain('"completion_checklist"->>\'schemaVersion\' = \'1\'');
    expect(migration).toContain('RECIPIENT_STATE_CONFIRMED');
    expect(migration).toContain('FOLLOW_UP_RISK_REVIEWED');
    expect(migration).toContain('jsonb_array_length("completion_checklist"->\'confirmations\') = 3');
    expect(migration).toContain('("text" IS NULL AND "content_deleted_at" IS NOT NULL)');
    expect(migration).toContain('jsonb_array_length("evidence") = 0');
    expect(migration).toContain('"output" IS NULL');
  });

  it('ships an explicit rollback that cannot remove M00-M02 tables', async () => {
    const rollback = await readFile(rollbackUrl, 'utf8');
    expect(rollback).toContain('DROP TABLE IF EXISTS');
    expect(rollback).toContain('"work_orders"');
    expect(rollback).toContain('DROP TYPE IF EXISTS "WorkOrderStatus"');
    for (const protectedTable of ['elders', 'facilities', 'users', 'outbox_events']) {
      expect(rollback).not.toContain(`"${protectedTable}"`);
    }
  });

  it('contains only fictional deterministic fixtures with consent and family sharing', async () => {
    const seed = await readFile(seedUrl, 'utf8');
    expect(seed).toContain('我想喝热水，今天有点头晕。');
    expect(seed).toContain("fixtureKey: 'HOT_WATER_DIZZINESS_V1'");
    expect(seed).toContain("purpose: 'VOICE_CAPTURE'");
    expect(seed).toContain("purpose: 'TRANSCRIPTION_AI_ANALYSIS'");
    expect(seed).toContain("field: 'TIMELINE_SUMMARY'");
    expect(seed).toContain('M03_SEED_EXPECTATIONS');
    expect(seed).toContain("SET LOCAL eldercare.seed_mode = 'on'");
  });
});

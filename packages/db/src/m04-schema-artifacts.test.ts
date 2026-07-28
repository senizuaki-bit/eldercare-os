import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const schemaUrl = new URL('../prisma/schema.prisma', import.meta.url);
const migrationUrl = new URL(
  '../prisma/migrations/20260728000000_emergency/migration.sql',
  import.meta.url,
);
const rollbackUrl = new URL(
  '../prisma/migrations/20260728000000_emergency/rollback.sql',
  import.meta.url,
);
const seedUrl = new URL('../prisma/seed.ts', import.meta.url);

describe('M04 emergency database artifacts', () => {
  it('models the full auditable emergency workflow and exact state machine', async () => {
    const schema = await readFile(schemaUrl, 'utf8');
    for (const model of [
      'EmergencySourceBinding',
      'EmergencySignal',
      'EmergencyEvent',
      'EmergencyLocationSnapshot',
      'EmergencyTransition',
      'EmergencyRelatedEvent',
      'EmergencyAcknowledgement',
      'EmergencyResponder',
      'EmergencyResponderAssignment',
      'EmergencyResponseMilestone',
      'EscalationPolicy',
      'EscalationStep',
      'EmergencyEscalation',
      'EmergencyResolution',
      'EmergencyReview',
      'FamilyEmergencyNotificationPreference',
      'EmergencyFamilySummary',
      'EmergencyNotificationDelivery',
      'EmergencyCommandReceipt',
    ]) {
      expect(schema).toContain(`model ${model} {`);
    }

    const statusBody = schema.match(/enum EmergencyStatus \{([\s\S]*?)\}/)?.[1] ?? '';
    expect(statusBody.match(/[A-Z_]+/g)).toEqual([
      'OPEN',
      'ACKNOWLEDGED',
      'RESPONDING',
      'RESOLVED',
      'REVIEWED',
    ]);
    expect(statusBody).not.toContain('ON_SITE');
  });

  it('pins tenant scope, replay idempotency and escalation idempotency', async () => {
    const schema = await readFile(schemaUrl, 'utf8');
    expect(schema).toContain(
      '@@unique([organizationId, facilityId, sourceIdentityKey, externalEventId])',
    );
    expect(schema).toContain(
      '@@unique([emergencyEventId, stage, escalationStepId, basisTransitionVersion])',
    );
    expect(schema).toContain('@@unique([organizationId, idempotencyKey])');
    expect(schema).toContain(
      '@@unique([organizationId, actorUserId, commandKind, idempotencyKey]',
    );
    expect(schema).toContain(
      '@@unique([emergencyEventId, toVersion], map: "emergency_responder_assignments_emergency_event_id_to_key")',
    );
    expect(schema).toContain(
      '@@index([status, cancelledAt, id], map: "emergency_escalations_status_cancelled_at_id_idx")',
    );
    expect(schema).toContain('@@unique([primaryEventId, relatedEventId])');
    expect(schema).toContain('retentionUntil');
  });

  it('enforces human finalization, ordered evidence and immutable audit facts', async () => {
    const migration = await readFile(migrationUrl, 'utf8');
    expect(migration).toContain('emergency_events_status_evidence');
    expect(migration).toContain('emergency_events_validate_transition');
    expect(migration).toContain('invalid emergency status transition');
    expect(migration).toContain('emergency_transitions_human_finalization');
    expect(migration).toContain('"actor_type" = \'USER\'');
    expect(migration).toContain('emergency_related_events_not_self');
    expect(migration).toContain('emergency_location_state_shape');
    expect(migration).toContain('emergency_escalations_status_timestamps');
    expect(migration).toContain('eldercare_reject_emergency_audit_mutation');
    expect(migration).toContain('emergency_command_receipts_append_only');
    expect(migration).toContain('emergency_command_receipts_fingerprint_sha256');
    expect(migration).toContain('emergency_responder_assignments_append_only');
    expect(migration).toContain('emergency_responder_assignments_version_step');
    expect(migration).toContain('emergency_responder_assignments_elevation_shape');
    expect(migration).toContain("current_setting('eldercare.seed_mode', true) = 'on'");
    expect(migration).toContain('SCENE_SAFETY_CONFIRMED');
    expect(migration).toContain('ELDER_STATE_CONFIRMED');
    expect(migration).toContain('FOLLOW_UP_HANDOFF_CONFIRMED');
  });

  it('ships a rollback that preserves all M00-M03 data', async () => {
    const rollback = await readFile(rollbackUrl, 'utf8');
    expect(rollback).toContain('"emergency_events"');
    expect(rollback).toContain('"emergency_responder_assignments"');
    expect(rollback).toContain('"emergency_command_receipts"');
    expect(rollback).toContain('DROP TYPE IF EXISTS "EmergencyStatus"');
    for (const protectedTable of [
      'organizations',
      'facilities',
      'users',
      'elders',
      'work_orders',
      'needs',
      'outbox_events',
    ]) {
      expect(rollback).not.toContain(`DROP TABLE IF EXISTS "${protectedTable}"`);
    }
  });

  it('provides deterministic fictional operations, IoT and family-safe fixtures', async () => {
    const seed = await readFile(seedUrl, 'utf8');
    expect(seed).toContain("externalSourceId: 'call-device-qinglan-001'");
    expect(seed).toContain("sourceIdentityKey: `binding:${emergencySourceBindingId}`");
    expect(seed).toContain("reasonCode: 'NEAR_DUPLICATE_WINDOW'");
    expect(seed).toContain("state: 'STALE'");
    expect(seed).toContain("state: 'UNKNOWN'");
    expect(seed).toContain("notifyOnOpened: false");
    expect(seed).toContain("notifyOnResolved: true");
    expect(seed).toContain('M04_SEED_EXPECTATIONS');
    expect(seed).toContain("action: 'SYSTEM.M04_SEED_APPLIED'");
  });
});

import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const schemaUrl = new URL('../prisma/schema.prisma', import.meta.url);
const migrationUrl = new URL(
  '../prisma/migrations/20260713000000_elder_management/migration.sql',
  import.meta.url,
);
const rollbackUrl = new URL(
  '../prisma/migrations/20260713000000_elder_management/rollback.sql',
  import.meta.url,
);

describe('M02 schema artifacts', () => {
  it('matches the finalized directory, elder, consent and staffing contracts', async () => {
    const schema = await readFile(schemaUrl, 'utf8');
    const requiredModels = [
      'Building',
      'Floor',
      'Zone',
      'Room',
      'Bed',
      'CareLevel',
      'Elder',
      'AdmissionRecord',
      'ElderStay',
      'FamilyRelationship',
      'EmergencyContact',
      'AccessibilityProfile',
      'CommunicationPreference',
      'PersonalBaseline',
      'ConsentRecord',
      'SharingPreference',
      'StaffProfile',
      'Team',
      'TeamMembership',
      'Shift',
      'ShiftAssignment',
      'ShiftAssignmentScope',
      'ElderCareAssignment',
      'ElderTimelineEntry',
      'OutboxEvent',
    ];

    for (const model of requiredModels) {
      expect(schema).toContain(`model ${model} {`);
    }

    expect(schema).toMatch(/enum ElderRecordStatus \{[\s\S]*?DISCHARGED/);
    expect(schema).toMatch(/enum ElderStayStatus \{[\s\S]*?PLANNED[\s\S]*?ACTIVE[\s\S]*?DISCHARGED[\s\S]*?CANCELLED/);
    expect(schema).toMatch(/enum ConsentPurpose \{[\s\S]*?CAREGIVER_SHIFT_LOCATION/);
    expect(schema).toMatch(/enum ConsentDecision \{[\s\S]*?DECLINED/);
    expect(schema).toMatch(/enum ConsentAuthority \{[\s\S]*?AUTHORIZED_REPRESENTATIVE[\s\S]*?LEGAL_BASIS/);
    expect(schema).toMatch(/enum ShiftStatus \{[\s\S]*?SCHEDULED[\s\S]*?IN_PROGRESS[\s\S]*?COMPLETED[\s\S]*?CANCELLED/);
    expect(schema).toMatch(/enum ShiftAssignmentStatus \{[\s\S]*?ASSIGNED[\s\S]*?ACCEPTED[\s\S]*?CANCELLED/);
    expect(schema).toMatch(/enum TimelineVisibility \{[\s\S]*?INTERNAL[\s\S]*?ELDER_VISIBLE[\s\S]*?FAMILY_ELIGIBLE/);

    for (const field of [
      'sortOrder',
      'levelNumber',
      'operationalStatus',
      'previousStayId',
      'admissionReasonCode',
      'dischargeReasonCode',
      'preferredTextScale',
      'humanHandoffPreferred',
      'repeatKeyInformation',
      'confirmedByStaffProfileId',
      'inferenceMethod',
      'consentVersion',
      'reasonCode',
      'primaryTeamId',
      'sourceResourceType',
      'safeSummaryCode',
      'safeMetadata',
      'shiftAssignmentId',
    ]) {
      expect(schema).toContain(field);
    }
  });

  it('adds optimistic versions to every mutable M02 aggregate', async () => {
    const schema = await readFile(schemaUrl, 'utf8');
    const versionedModels = [
      'Building',
      'Floor',
      'Zone',
      'Room',
      'Bed',
      'CareLevel',
      'Elder',
      'AdmissionRecord',
      'ElderStay',
      'FamilyRelationship',
      'EmergencyContact',
      'AccessibilityProfile',
      'CommunicationPreference',
      'PersonalBaseline',
      'SharingPreference',
      'StaffProfile',
      'Team',
      'TeamMembership',
      'Shift',
      'ShiftAssignment',
      'ElderCareAssignment',
    ];

    for (const model of versionedModels) {
      const body = schema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`))?.[1];
      expect(body, `${model} should exist`).toBeDefined();
      expect(body, `${model} should be versioned`).toMatch(/\n\s+version\s+Int\s+@default\(1\)/);
    }

    const migration = await readFile(migrationUrl, 'utf8');
    for (const table of [
      'buildings',
      'floors',
      'zones',
      'rooms',
      'beds',
      'care_levels',
      'elders',
      'admission_records',
      'elder_stays',
      'family_relationships',
      'emergency_contacts',
      'accessibility_profiles',
      'communication_preferences',
      'personal_baselines',
      'sharing_preferences',
      'staff_profiles',
      'teams',
      'team_memberships',
      'shifts',
      'shift_assignments',
      'elder_care_assignments',
    ]) {
      expect(migration).toContain(`CONSTRAINT "${table}_values_check"`);
    }
  });

  it('keeps contract-valid 160-character display labels within database bounds', async () => {
    const [schema, migration] = await Promise.all([
      readFile(schemaUrl, 'utf8'),
      readFile(migrationUrl, 'utf8'),
    ]);
    const fields = [
      ['Bed', 'label', 'beds', 'label'],
      ['CareLevel', 'name', 'care_levels', 'name'],
      ['Elder', 'displayName', 'elders', 'display_name'],
      ['EmergencyContact', 'displayName', 'emergency_contacts', 'display_name'],
      ['StaffProfile', 'displayName', 'staff_profiles', 'display_name'],
      ['Team', 'name', 'teams', 'name'],
      ['Shift', 'name', 'shifts', 'name'],
    ] as const;

    for (const [model, field, table, column] of fields) {
      const modelBody = schema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`))?.[1];
      const tableBody = migration.match(new RegExp(`CREATE TABLE "${table}" \\(([\\s\\S]*?)\\n\\);`))?.[1];
      expect(modelBody, `${model} should exist`).toMatch(
        new RegExp(`\\n\\s+${field}\\s+String\\??[\\s\\S]*?@db\\.VarChar\\(160\\)`),
      );
      expect(tableBody, `${table} should exist`).toContain(`"${column}" VARCHAR(160)`);
    }
  });

  it('prevents overlapping actual stays while intentionally not blocking planned reservations', async () => {
    const migration = await readFile(migrationUrl, 'utf8');

    expect(migration).toContain('CREATE EXTENSION IF NOT EXISTS "btree_gist"');
    expect(migration).toContain('CONSTRAINT "elder_stays_bed_time_no_overlap"');
    expect(migration).toContain('CONSTRAINT "elder_stays_elder_time_no_overlap"');
    expect(migration).toContain('tstzrange("admitted_at", COALESCE("discharged_at",');
    expect(migration).toContain("WHERE (\"status\" IN ('ACTIVE', 'DISCHARGED'))");
    expect(migration).not.toContain("WHERE (\"status\" IN ('PLANNED', 'ACTIVE', 'DISCHARGED'))");
    expect(migration).toContain('DEFERRABLE INITIALLY IMMEDIATE');
    expect(migration).toContain('"elder_stays_one_open_per_bed_key"');
    expect(migration).toContain('"elder_stays_one_open_per_elder_key"');
    expect(migration).toContain('"admission_records_one_open_per_elder_key"');
  });

  it('uses tenant-bound composite foreign keys throughout hierarchy and assignment facts', async () => {
    const migration = await readFile(migrationUrl, 'utf8');
    const requiredCompositeForeignKeys = [
      'floors_building_id_organization_id_facility_id_fkey',
      'rooms_zone_id_organization_id_facility_id_floor_id_fkey',
      'beds_room_id_organization_id_facility_id_fkey',
      'elder_stays_admission_record_id_elder_id_organization_id_f_fkey',
      'elder_stays_previous_stay_id_elder_id_organization_id_faci_fkey',
      'family_relationships_elder_id_organization_id_facility_id_fkey',
      'sharing_preferences_family_relationship_id_elder_id_organi_fkey',
      'team_memberships_staff_profile_id_organization_id_facility_fkey',
      'shift_assignment_scopes_shift_assignment_id_organization_i_fkey',
      'shift_assignment_scopes_floor_id_organization_id_facility__fkey',
      'shift_assignment_scopes_zone_id_organization_id_facility_i_fkey',
      'elder_care_assignments_shift_assignment_id_organization_id_fkey',
      'elder_care_assignments_elder_id_organization_id_facility_i_fkey',
    ];

    for (const constraint of requiredCompositeForeignKeys) {
      expect(migration).toContain(`CONSTRAINT "${constraint}"`);
    }
  });

  it('models assignment scope as validated, repeatable shift facts', async () => {
    const migration = await readFile(migrationUrl, 'utf8');

    expect(migration).toContain('CREATE TABLE "shift_assignment_scopes"');
    expect(migration).toContain('CONSTRAINT "shift_assignment_scopes_values_check"');
    expect(migration).toContain("(\"kind\" = 'FACILITY' AND \"floor_id\" IS NULL AND \"zone_id\" IS NULL)");
    expect(migration).toContain("(\"kind\" = 'FLOOR' AND \"floor_id\" IS NOT NULL AND \"zone_id\" IS NULL)");
    expect(migration).toContain("(\"kind\" = 'ZONE' AND \"floor_id\" IS NOT NULL AND \"zone_id\" IS NOT NULL)");
    expect(migration).toContain('"shift_assignment_scopes_one_facility_key"');
    expect(migration).toContain('"shift_assignment_scopes_floor_key"');
    expect(migration).toContain('"shift_assignment_scopes_zone_key"');
    expect(migration).not.toContain('"shift_assignments_data_scope_id');
  });

  it('keeps current consent, sharing and baseline values unique while preserving history', async () => {
    const migration = await readFile(migrationUrl, 'utf8');

    expect(migration).toContain('"consent_records_current_purpose_key"');
    expect(migration).toContain('"sharing_preferences_current_field_key"');
    expect(migration).toContain('"personal_baselines_current_key"');
    expect(migration).toContain('WHERE "superseded_at" IS NULL');
    expect(migration).toContain('CONSTRAINT "consent_records_values_check"');
    expect(migration).toContain('CONSTRAINT "personal_baselines_values_check"');
    expect(migration).toContain('"source_kind" = \'STAFF_CONFIRMED\'');
    expect(migration).toContain('"source_kind" = \'INFERRED\'');
  });

  it('provides an idempotent, tenant-bound transactional outbox record', async () => {
    const migration = await readFile(migrationUrl, 'utf8');

    expect(migration).toContain('CREATE TABLE "outbox_events"');
    expect(migration).toContain('"outbox_events_organization_id_event_type_idempotency_key_key"');
    expect(migration).toContain('"outbox_events_facility_id_organization_id_fkey"');
    expect(migration).toContain('CONSTRAINT "outbox_events_values_check"');
    expect(migration).toContain('jsonb_typeof("payload") = \'object\'');
    expect(migration).toContain('"status", "available_at"');
  });

  it('rolls back only M02 artifacts and preserves all M00/M01 tables', async () => {
    const rollback = await readFile(rollbackUrl, 'utf8');

    for (const table of [
      'outbox_events',
      'shift_assignment_scopes',
      'shift_assignments',
      'elder_stays',
      'elders',
      'buildings',
    ]) {
      expect(rollback).toContain(`DROP TABLE IF EXISTS "${table}"`);
    }
    for (const protectedTable of [
      '_system_metadata',
      'organizations',
      'facilities',
      'users',
      'user_roles',
      'data_scopes',
      'auth_sessions',
      'audit_events',
    ]) {
      expect(rollback).not.toContain(`DROP TABLE IF EXISTS "${protectedTable}"`);
    }
    expect(rollback).toContain('DROP TYPE IF EXISTS "ShiftScopeKind"');
    expect(rollback).toContain('DROP TYPE IF EXISTS "ConsentAuthority"');
    expect(rollback).toContain('DROP INDEX IF EXISTS "data_scopes_id_organization_id_facility_id_key"');
    expect(rollback).not.toContain('DROP EXTENSION IF EXISTS "btree_gist"');
    expect(rollback).not.toContain('UPDATE "_system_metadata"');
  });
});

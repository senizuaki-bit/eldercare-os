import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const seedUrl = new URL('../prisma/seed.ts', import.meta.url);

describe('M02 fictional seed artifacts', () => {
  it('declares the complete Qinglan main operational fixture manifest', async () => {
    const seed = await readFile(seedUrl, 'utf8');

    for (const expectation of [
      'buildings: 2',
      'floors: 4',
      'zones: 8',
      'rooms: 8',
      'beds: 16',
      'occupiedBeds: 12',
      'elders: 12',
      'careLevels: 3',
      'staffProfiles: 10',
      'caregivers: 8',
      'familyAccounts: 3',
      'shifts: 17',
      'shiftAssignments: 17',
      'shiftAssignmentScopes: 17',
    ]) {
      expect(seed).toContain(expectation);
    }

    expect(seed).toContain("operationalStatus: index === 15 ? 'OUT_OF_SERVICE' : 'ACTIVE'");
    expect(seed).toContain('const weeklyShifts = Array.from({ length: 14 }');
    expect(seed).toContain("status: 'IN_PROGRESS'");
    expect(seed).toContain("status: 'COMPLETED'");
    expect(seed).toContain("status: 'CANCELLED'");
  });

  it('preserves M01 accounts and negative tenant/facility fixtures while adding M02 permissions', async () => {
    const seed = await readFile(seedUrl, 'utf8');

    for (const login of [
      'platform.admin',
      'facility.director',
      'nursing.supervisor',
      'caregiver.demo',
      'device.manager',
      'elder.demo',
      'family.demo',
    ]) {
      expect(seed).toContain(login);
    }
    expect(seed).toContain('M02_PERMISSIONS');
    expect(seed).toContain("'QL-EAST', '青岚东院区（隔离样本）'");
    expect(seed).toContain("'SH-MAIN', '松鹤主院区（跨租户隔离样本）'");
    expect(seed).toContain(`scopeKey: \`facility:\${ids.facilities.qinglanEast}\``);

    const caregiverPermissions = seed.slice(
      seed.indexOf('  CAREGIVER: ['),
      seed.indexOf('  DEVICE_MANAGER: ['),
    );
    for (const permission of [
      'FACILITY_DIRECTORY_READ',
      'CARE_LEVEL_READ',
      'STAFF_READ',
      'SHIFT_READ',
    ]) {
      expect(caregiverPermissions).not.toContain(permission);
    }
    expect(caregiverPermissions).toContain('ELDER_READ_BASIC');

    const devicePermissions = seed.slice(
      seed.indexOf('  DEVICE_MANAGER: ['),
      seed.indexOf('  ELDER: ['),
    );
    expect(devicePermissions).not.toContain('FACILITY_DIRECTORY_READ');
    expect(devicePermissions).not.toContain('STAFF_READ');
  });

  it('covers family verification, consent history and every baseline provenance', async () => {
    const seed = await readFile(seedUrl, 'utf8');

    for (const value of [
      "status: 'VERIFIED'",
      "status: 'PENDING'",
      "status: 'REVOKED'",
      "sourceKind: 'ELDER_STATED'",
      "sourceKind: 'STAFF_CONFIRMED'",
      "sourceKind: 'INFERRED'",
      "decision: 'GRANTED'",
      "decision: 'WITHDRAWN'",
      "decision: 'DECLINED'",
      "'AUTHORIZED_REPRESENTATIVE'",
      "purpose: 'CAREGIVER_SHIFT_LOCATION'",
      "field: 'PERSONAL_BASELINE_SUMMARY', allowed: false",
    ]) {
      expect(seed).toContain(value);
    }
    expect(seed).toContain('confirmedByStaffProfileId');
    expect(seed).toContain("inferenceMethod: 'fixture_pattern_v1'");
  });

  it('derives finite authorization cache rows from real assignment windows and resources', async () => {
    const seed = await readFile(seedUrl, 'utf8');

    expect(seed).toContain('validFrom: demoShiftValidFrom');
    expect(seed).toContain('validUntil: demoShiftValidUntil');
    expect(seed).toContain("kind: 'ACTIVE_SHIFT'");
    expect(seed).toContain('scopeKey: `active-shift:${assignmentId}`');
    expect(seed).toContain("kind: 'FLOOR'");
    expect(seed).toContain("resourceType: 'FLOOR'");
    expect(seed).toContain("kind: 'ASSIGNED_ELDER'");
    expect(seed).toContain("resourceType: 'ELDER'");
    expect(seed).toContain("kind: 'ZONE', floorId, zoneId");
    expect(seed).toContain("kind: 'FLOOR', floorId");
    expect(seed).toContain('if (index % 3 !== 0)');
    expect(seed).not.toContain("shiftAssignmentId: assignmentId, kind: 'FACILITY'");
    expect(seed).not.toContain('dataScopeId:');
  });

  it('is repeatable, scoped, auditable and contains fictional contact data only', async () => {
    const seed = await readFile(seedUrl, 'utf8');

    expect(seed).toContain('await prisma.$transaction');
    expect(seed).toContain('await transaction.elderTimelineEntry.deleteMany');
    expect(seed).toContain('await transaction.building.deleteMany');
    expect(seed).toContain('await transaction.dataScope.deleteMany');
    expect(seed).toContain('skipDuplicates: true');
    expect(seed).toContain('SYSTEM.M02_SEED_APPLIED');
    expect(seed).toContain("schemaVersion: '1.2'");
    expect(seed).toContain("milestone: 'M02'");
    expect(seed).toContain('@example.invalid');
    expect(seed).toContain('fictionalDemoData: true');
    expect(seed).not.toContain('Math.random');
    expect(seed).not.toMatch(/@(?:gmail|qq|163|outlook)\./i);
  });
});

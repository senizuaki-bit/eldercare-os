import { describe, expect, it } from 'vitest';

import {
  bedSchema,
  buildingCreateRequestSchema,
  buildingUpdateRequestSchema,
  roomSchema,
  roomsQuerySchema,
} from './facility-directory.js';
import {
  admitElderRequestSchema,
  communicationPreferenceSchema,
  consentHistoryQuerySchema,
  consentRecordCreateRequestSchema,
  elderStaySchema,
  elderTimelineQuerySchema,
  eldersQuerySchema,
  familyElderSummarySchema,
  familyRelationshipSchema,
  personalBaselineCreateRequestSchema,
  sharingPreferencesUpdateRequestSchema,
} from './elder.js';
import {
  shiftAssignmentCreateRequestSchema,
  shiftAssignmentScopeInputSchema,
  shiftAssignmentUpdateRequestSchema,
  shiftCreateRequestSchema,
  shiftUpdateRequestSchema,
  shiftsQuerySchema,
  staffProfileSchema,
  staffUpdateRequestSchema,
  teamMembershipCreateRequestSchema,
  teamMembershipUpdateRequestSchema,
  teamUpdateRequestSchema,
} from './staffing.js';

const ids = {
  organization: '10000000-0000-4000-8000-000000000001',
  facility: '20000000-0000-4000-8000-000000000001',
  building: '30000000-0000-4000-8000-000000000001',
  floor: '40000000-0000-4000-8000-000000000001',
  zone: '50000000-0000-4000-8000-000000000001',
  room: '60000000-0000-4000-8000-000000000001',
  bed: '70000000-0000-4000-8000-000000000001',
  elder: '80000000-0000-4000-8000-000000000001',
  stay: '90000000-0000-4000-8000-000000000001',
  user: 'a0000000-0000-4000-8000-000000000001',
  staff: 'b0000000-0000-4000-8000-000000000001',
  shift: 'c0000000-0000-4000-8000-000000000001',
  assignment: 'd0000000-0000-4000-8000-000000000001',
} as const;

const timestamp = '2026-07-13T08:00:00.000Z';

describe('M02 facility directory contracts', () => {
  it('applies ergonomic defaults while rejecting unknown create fields', () => {
    expect(buildingCreateRequestSchema.parse({ code: 'A', name: '颐养楼' })).toEqual({
      code: 'A',
      name: '颐养楼',
      status: 'ACTIVE',
      sortOrder: 0,
    });
    expect(
      buildingCreateRequestSchema.safeParse({ code: 'A', name: '颐养楼', occupied: true }).success,
    ).toBe(false);
  });

  it('requires optimistic version plus an actual mutation', () => {
    expect(buildingUpdateRequestSchema.safeParse({ expectedVersion: 2 }).success).toBe(false);
    expect(
      buildingUpdateRequestSchema.safeParse({ expectedVersion: 2, name: '新楼名' }).success,
    ).toBe(true);
  });

  it('parses search/filter/sort/pagination defaults and strict filters', () => {
    expect(roomsQuerySchema.parse({ page: '2', floorId: ids.floor })).toMatchObject({
      page: 2,
      pageSize: 20,
      floorId: ids.floor,
      occupancy: 'ANY',
      sort: 'code',
      direction: 'asc',
    });
    expect(roomsQuerySchema.safeParse({ unsafeTenantId: ids.organization }).success).toBe(false);
  });

  it('does not accept impossible room/bed derived state', () => {
    const room = {
      id: ids.room,
      organizationId: ids.organization,
      facilityId: ids.facility,
      floorId: ids.floor,
      zoneId: ids.zone,
      code: 'R01',
      name: '向阳 201',
      status: 'ACTIVE',
      bedCount: 3,
      activeBedCount: 2,
      occupiedBedCount: 1,
      availableBedCount: 1,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    } as const;
    expect(roomSchema.safeParse(room).success).toBe(true);
    expect(roomSchema.safeParse({ ...room, activeBedCount: 4 }).success).toBe(false);
    expect(roomSchema.safeParse({ ...room, availableBedCount: 2 }).success).toBe(false);

    expect(
      bedSchema.safeParse({
        id: ids.bed,
        organizationId: ids.organization,
        facilityId: ids.facility,
        roomId: ids.room,
        code: 'B01',
        label: '1 号床',
        operationalStatus: 'ACTIVE',
        occupancy: null,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        isOccupied: true,
      }).success,
    ).toBe(false);
  });
});

describe('M02 elder directory and lifecycle contracts', () => {
  it('supports allowlisted list filters and refuses arbitrary sort fields', () => {
    expect(eldersQuerySchema.parse({ page: '1', floorId: ids.floor })).toMatchObject({
      page: 1,
      pageSize: 20,
      sort: 'displayName',
      direction: 'asc',
    });
    expect(eldersQuerySchema.safeParse({ sort: 'birthDate' }).success).toBe(false);
  });

  it('requires admission version, bed and timestamp and rejects client tenant identifiers', () => {
    expect(
      admitElderRequestSchema.parse({
        expectedElderVersion: 1,
        bedId: ids.bed,
        admittedAt: timestamp,
      }),
    ).toEqual({ expectedElderVersion: 1, bedId: ids.bed, admittedAt: timestamp });
    expect(
      admitElderRequestSchema.safeParse({
        expectedElderVersion: 1,
        bedId: ids.bed,
        admittedAt: timestamp,
        organizationId: ids.organization,
      }).success,
    ).toBe(false);
  });

  it('enforces stay status/timestamp invariants', () => {
    const base = {
      id: ids.stay,
      organizationId: ids.organization,
      facilityId: ids.facility,
      elderId: ids.elder,
      bedId: ids.bed,
      previousStayId: null,
      status: 'ACTIVE',
      admittedAt: timestamp,
      dischargedAt: null,
      admissionReasonCode: null,
      dischargeReasonCode: null,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    expect(elderStaySchema.safeParse(base).success).toBe(true);
    expect(
      elderStaySchema.safeParse({ ...base, status: 'DISCHARGED', dischargedAt: null }).success,
    ).toBe(false);
    expect(
      elderStaySchema.safeParse({
        ...base,
        status: 'DISCHARGED',
        dischargedAt: '2026-07-13T07:59:59.000Z',
      }).success,
    ).toBe(false);
  });

  it('requires family lifecycle timestamps to agree with relationship status', () => {
    const relationship = {
      id: ids.assignment,
      organizationId: ids.organization,
      facilityId: ids.facility,
      elderId: ids.elder,
      familyUserId: ids.user,
      relationshipKind: 'CHILD',
      relationshipLabel: null,
      status: 'VERIFIED',
      activeFrom: timestamp,
      activeUntil: null,
      verifiedAt: null,
      revokedAt: null,
      sharingPreferences: [],
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    expect(familyRelationshipSchema.safeParse(relationship).success).toBe(false);
    expect(
      familyRelationshipSchema.safeParse({ ...relationship, verifiedAt: timestamp }).success,
    ).toBe(true);
  });

  it('rejects duplicate family fields and client-controlled activation times', () => {
    const preference = {
      field: 'CARE_LEVEL',
      allowed: true,
    } as const;
    expect(
      sharingPreferencesUpdateRequestSchema.safeParse({
        expectedVersion: 1,
        preferences: [preference, preference],
      }).success,
    ).toBe(false);
    expect(
      sharingPreferencesUpdateRequestSchema.safeParse({
        expectedVersion: 1,
        preferences: [
          { ...preference, validFrom: timestamp },
        ],
      }).success,
    ).toBe(false);
  });

  it.each([
    [
      'ELDER_STATED',
      { sourceUserId: ids.user },
    ],
    [
      'STAFF_CONFIRMED',
      { confirmedByStaffProfileId: ids.staff },
    ],
    [
      'INFERRED',
      { inferenceMethod: 'fixture-rule-v1', confidence: 0.7 },
    ],
  ] as const)('accepts explicit %s baseline provenance', (sourceKind, sourceFields) => {
    expect(
      personalBaselineCreateRequestSchema.safeParse({
        baselineKey: 'morning-routine',
        domain: 'ROUTINE',
        value: '习惯早起（虚构）',
        sourceKind,
        observedAt: timestamp,
        validFrom: timestamp,
        ...sourceFields,
      }).success,
    ).toBe(true);
  });

  it('rejects missing or mixed personal-baseline provenance', () => {
    const base = {
      baselineKey: 'morning-routine',
      domain: 'ROUTINE',
      value: '习惯早起（虚构）',
      observedAt: timestamp,
      validFrom: timestamp,
    };
    expect(
      personalBaselineCreateRequestSchema.safeParse({ ...base, sourceKind: 'INFERRED' }).success,
    ).toBe(false);
    expect(
      personalBaselineCreateRequestSchema.safeParse({
        ...base,
        sourceKind: 'ELDER_STATED',
        sourceUserId: ids.user,
        confidence: 0.8,
      }).success,
    ).toBe(false);
  });

  it('validates consent date order and parses false query values as false', () => {
    expect(
      consentRecordCreateRequestSchema.safeParse({
        expectedElderVersion: 1,
        purpose: 'FAMILY_SHARING',
        decision: 'GRANTED',
        authority: 'ELDER',
        effectiveAt: timestamp,
        expiresAt: '2026-07-13T07:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(consentHistoryQuerySchema.parse({ currentOnly: 'false' }).currentOnly).toBe(false);
  });

  it('validates timeline ranges', () => {
    expect(
      elderTimelineQuerySchema.safeParse({
        occurredFrom: '2026-07-14T08:00:00.000Z',
        occurredTo: timestamp,
      }).success,
    ).toBe(false);
  });

  it('makes the family projection contract fail closed on internal or precise staff fields', () => {
    expect(
      familyElderSummarySchema.safeParse({
        id: ids.elder,
        displayName: '虚构老人甲',
        sharedFields: [],
        internalNotes: '不可泄露',
      }).success,
    ).toBe(false);
    expect(
      familyElderSummarySchema.safeParse({
        id: ids.elder,
        displayName: '虚构老人甲',
        sharedFields: [],
        caregiverLocation: { x: 1, y: 2 },
      }).success,
    ).toBe(false);
    expect(
      familyElderSummarySchema.safeParse({
        id: ids.elder,
        displayName: '虚构老人甲',
        preferredName: '张阿姨',
        sharedFields: [],
      }).success,
    ).toBe(false);
    expect(
      familyElderSummarySchema.safeParse({
        id: ids.elder,
        displayName: '虚构老人甲',
        preferredName: '张阿姨',
        sharedFields: ['PREFERRED_NAME'],
      }).success,
    ).toBe(true);
  });

  it('requires both quiet-hour boundaries in stored communication preferences', () => {
    expect(
      communicationPreferenceSchema.safeParse({
        elderId: ids.elder,
        preferredLanguage: 'zh-CN',
        speakingPace: 'SLOW',
        repeatKeyInformation: true,
        preferredChannel: 'VOICE',
        quietHoursStart: '21:00',
        quietHoursEnd: null,
        version: 1,
        updatedAt: timestamp,
      }).success,
    ).toBe(false);
  });
});

describe('M02 staffing and weekly shift contracts', () => {
  it('rejects staff employment dates in reverse order', () => {
    expect(
      staffProfileSchema.safeParse({
        id: ids.staff,
        organizationId: ids.organization,
        facilityId: ids.facility,
        userId: ids.user,
        employeeCode: 'CG-001',
        displayName: '虚构护工甲',
        jobTitle: '护工',
        status: 'ACTIVE',
        hiredAt: '2026-07-14',
        endedAt: '2026-07-13',
        primaryTeamId: null,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      }).success,
    ).toBe(false);
  });

  it('validates team membership time ranges', () => {
    expect(
      teamMembershipCreateRequestSchema.safeParse({
        staffProfileId: ids.staff,
        activeFrom: timestamp,
        activeUntil: '2026-07-13T07:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it.each([
    [{ kind: 'FACILITY' }, true],
    [{ kind: 'FACILITY', floorId: ids.floor }, false],
    [{ kind: 'FLOOR', floorId: ids.floor }, true],
    [{ kind: 'FLOOR', floorId: ids.floor, zoneId: ids.zone }, false],
    [{ kind: 'ZONE', floorId: ids.floor, zoneId: ids.zone }, true],
    [{ kind: 'ZONE', zoneId: ids.zone }, false],
  ])('validates shift assignment scope shape %#', (scope, accepted) => {
    expect(shiftAssignmentScopeInputSchema.safeParse(scope).success).toBe(accepted);
  });

  it('rejects duplicate scopes and duplicate elder assignments', () => {
    expect(
      shiftAssignmentCreateRequestSchema.safeParse({
        staffProfileId: ids.staff,
        scopes: [{ kind: 'FLOOR', floorId: ids.floor }, { kind: 'FLOOR', floorId: ids.floor }],
        elderAssignments: [
          { elderId: ids.elder, role: 'PRIMARY' },
          { elderId: ids.elder, role: 'SUPPORT' },
        ],
      }).success,
    ).toBe(false);
  });

  it('requires shift end after start and bounds weekly queries to fourteen days', () => {
    expect(
      shiftCreateRequestSchema.safeParse({
        code: 'DAY-01',
        name: '白班',
        startsAt: timestamp,
        endsAt: '2026-07-13T07:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      shiftsQuerySchema.safeParse({
        from: timestamp,
        to: '2026-08-13T08:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      shiftsQuerySchema.parse({
        from: timestamp,
        to: '2026-07-20T08:00:00.000Z',
      }),
    ).toMatchObject({ page: 1, pageSize: 50, sort: 'startsAt', direction: 'asc' });
  });

  it.each([
    [staffUpdateRequestSchema, { expectedVersion: 1, status: 'INACTIVE' }],
    [staffUpdateRequestSchema, { expectedVersion: 1, endedAt: '2026-07-14' }],
    [teamUpdateRequestSchema, { expectedVersion: 1, status: 'ARCHIVED' }],
    [teamMembershipUpdateRequestSchema, { expectedVersion: 1, activeUntil: timestamp }],
    [shiftUpdateRequestSchema, { expectedVersion: 1, status: 'CANCELLED' }],
    [shiftAssignmentUpdateRequestSchema, { expectedVersion: 1, status: 'CANCELLED' }],
  ])('requires an audit-safe reason code for staffing lifecycle transition %#', (schema, request) => {
    expect(schema.safeParse(request).success).toBe(false);
    expect(schema.safeParse({ ...request, reasonCode: 'SCHEDULE_CHANGE' }).success).toBe(true);
  });
});

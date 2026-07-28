import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ServiceConfig } from '@eldercare/config';
import {
  caregiverEmergenciesPageSchema,
  caregiverEmergencySchema,
  elderEmergencyStatusSchema,
  emergencyAdminDetailSchema,
  emergencyAdminPageSchema,
  familyEmergencyNotificationPreferenceSchema,
  familyEmergencySummariesPageSchema,
} from '@eldercare/contracts';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { DatabaseService } from '../../src/database/database.service.js';
import { configureHttpApplication } from '../../src/http-application.js';
import { SERVICE_CONFIG } from '../../src/tokens.js';

const ORIGIN = 'http://127.0.0.1:3001';
const DEMO_PASSWORD = 'LocalDemoOnly!2026';
const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000002';
const FACILITY_ID = '20000000-0000-4000-8000-000000000001';
const EAST_FACILITY_ID = '20000000-0000-4000-8000-000000000002';
const SONGHE_ORGANIZATION_ID = '10000000-0000-4000-8000-000000000003';
const SONGHE_FACILITY_ID = '20000000-0000-4000-8000-000000000003';
const SEEDED_OVERDUE_EVENT_ID = 'b4300000-0000-4000-8000-000000000001';
const SEEDED_RESPONDING_EVENT_ID = 'b4300000-0000-4000-8000-000000000002';
const SEEDED_REVIEWED_EVENT_ID = 'b4300000-0000-4000-8000-000000000003';
const SEEDED_UNKNOWN_EVENT_ID = 'b4300000-0000-4000-8000-000000000004';
const ELDER_ID = '87000000-0000-4000-8000-000000000001';
const FAMILY_RELATIONSHIP_ID = '8a000000-0000-4000-8000-000000000001';
const FAMILY_CONSENT_ID = '8f000000-0000-4000-8000-000000000001';
const FAMILY_TIMELINE_SHARING_ID = '91000000-0000-4000-8000-000000000004';
type TestAgent = ReturnType<typeof request.agent>;

describe.sequential('M04 auditable emergency workflow', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;
  let workflowEventId = '';
  let elevatedEventId = '';
  const previousRateLimitPrefix = process.env['AUTH_RATE_LIMIT_KEY_PREFIX'];
  const previousCorsOrigins = process.env['CORS_ORIGINS'];

  beforeAll(async () => {
    process.env['AUTH_RATE_LIMIT_KEY_PREFIX'] =
      `eldercare:m04-integration:${Date.now()}`;
    process.env['CORS_ORIGINS'] = ORIGIN;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureHttpApplication(app, app.get<ServiceConfig>(SERVICE_CONFIG));
    await app.init();
    server = app.getHttpServer() as Server;
    database = app.get(DatabaseService);
  });

  afterAll(async () => {
    await app?.close();
    restoreEnvironment(
      'AUTH_RATE_LIMIT_KEY_PREFIX',
      previousRateLimitPrefix,
    );
    restoreEnvironment('CORS_ORIGINS', previousCorsOrigins);
  });

  it('serves strict role-specific projections without leaking operational detail', async () => {
    const director = request.agent(server);
    await login(director, 'facility.director');
    const adminPage = emergencyAdminPageSchema.parse(
      (
        await director
          .get(adminPath('emergencies'))
          .query({
            page: 1,
            pageSize: 100,
            sortBy: 'status',
            sortDirection: 'asc',
          })
          .expect(200)
      ).body,
    );
    expect(
      adminPage.items.some((item) => item.id === SEEDED_RESPONDING_EVENT_ID),
    ).toBe(true);
    const stalePage = emergencyAdminPageSchema.parse(
      (
        await director
          .get(adminPath('emergencies'))
          .query({
            page: 1,
            pageSize: 100,
            locationState: 'STALE',
          })
          .expect(200)
      ).body,
    );
    expect(stalePage.items.length).toBeGreaterThan(0);
    expect(stalePage.items.every((item) => item.location.state === 'STALE')).toBe(
      true,
    );
    expect(stalePage.pageInfo.total).toBe(stalePage.items.length);

    const reviewed = emergencyAdminDetailSchema.parse(
      (
        await director
          .get(adminPath(`emergencies/${SEEDED_REVIEWED_EVENT_ID}`))
          .expect(200)
      ).body,
    );
    expect(reviewed.status).toBe('REVIEWED');
    expect(reviewed.requiredResolutionChecklistCodes).toEqual([
      'SCENE_SAFETY_CONFIRMED',
      'ELDER_STATE_CONFIRMED',
      'FOLLOW_UP_HANDOFF_CONFIRMED',
    ]);
    expect(reviewed.resolution?.completionChecklist).toEqual(
      reviewed.requiredResolutionChecklistCodes,
    );

    const caregiver = request.agent(server);
    await login(caregiver, 'caregiver.demo');
    const caregiverPage = caregiverEmergenciesPageSchema.parse(
      (await caregiver.get('/caregiver/emergencies').expect(200)).body,
    );
    expect(
      caregiverPage.items.some(
        (item) => item.id === SEEDED_RESPONDING_EVENT_ID && item.assignedToMe,
      ),
    ).toBe(true);

    const elder = request.agent(server);
    await login(elder, 'elder.demo');
    const elderStatus = elderEmergencyStatusSchema.parse(
      (
        await elder
          .get(`/elder/emergencies/${SEEDED_RESPONDING_EVENT_ID}`)
          .expect(200)
      ).body,
    );
    expect(elderStatus.humanResponseStartedAt).not.toBeNull();
    expect(elderStatus.fallbackPhoneNumber).toBe('400-000-0120');

    const family = request.agent(server);
    await login(family, 'family.demo');
    const familyPage = familyEmergencySummariesPageSchema.parse(
      (await family.get('/family/emergencies').expect(200)).body,
    );
    expect(
      familyPage.items.some(
        (item) => item.emergencyEventId === SEEDED_REVIEWED_EVENT_ID,
      ),
    ).toBe(true);
    expect(
      familyPage.items.every(
        (item) =>
          !('location' in item) &&
          !('currentResponder' in item) &&
          !('correlationId' in item),
      ),
    ).toBe(true);
    const preference = familyEmergencyNotificationPreferenceSchema.parse(
      (
        await family
          .get(
            `/family/elders/${ELDER_ID}/emergency-notification-preference`,
          )
          .expect(200)
      ).body,
    );
    expect(preference.version).toBeGreaterThanOrEqual(1);
  });

  it('enforces transaction-time responder access, CAS acknowledgement and replay idempotency', async () => {
    const elder = request.agent(server);
    const elderLogin = await login(elder, 'elder.demo');
    const elderCsrf = readCsrfToken(elderLogin);
    const externalEventId = `m04-api-${randomUUID()}`;
    const createKey = `m04-create-${randomUUID()}`;
    const createRequest = {
      externalEventId,
      idempotencyKey: createKey,
      reasonCode: 'ELDER_BUTTON_PRESSED',
    };
    const created = elderEmergencyStatusSchema.parse(
      (
        await elder
          .post('/elder/emergencies')
          .set('Origin', ORIGIN)
          .set('x-csrf-token', elderCsrf)
          .send(createRequest)
          .expect(200)
      ).body,
    );
    expect(created.status).toBe('OPEN');

    const replayedCreate = elderEmergencyStatusSchema.parse(
      (
        await elder
          .post('/elder/emergencies')
          .set('Origin', ORIGIN)
          .set('x-csrf-token', elderCsrf)
          .send({
            ...createRequest,
            idempotencyKey: `m04-retry-${randomUUID()}`,
          })
          .expect(200)
      ).body,
    );
    expect(replayedCreate.id).toBe(created.id);
    const changedSignal = await elder
      .post('/elder/emergencies')
      .set('Origin', ORIGIN)
      .set('x-csrf-token', elderCsrf)
      .send({
        ...createRequest,
        idempotencyKey: `m04-changed-${randomUUID()}`,
        reasonCode: 'ELDER_BUTTON_CHANGED_PAYLOAD',
      })
      .expect(409);
    expect(errorCode(changedSignal)).toBe('EMERGENCY_EVENT_ID_REUSED');

    const related = elderEmergencyStatusSchema.parse(
      (
        await elder
          .post('/elder/emergencies')
          .set('Origin', ORIGIN)
          .set('x-csrf-token', elderCsrf)
          .send({
            ...createRequest,
            externalEventId: `m04-related-${randomUUID()}`,
            idempotencyKey: `m04-related-${randomUUID()}`,
          })
          .expect(200)
      ).body,
    );
    expect(related.id).not.toBe(created.id);
    expect(
      await database.client.emergencyRelatedEvent.count({
        where: {
          primaryEventId: created.id,
          relatedEventId: related.id,
        },
      }),
    ).toBe(1);
    expect(
      await database.client.outboxEvent.count({
        where: {
          aggregateId: related.id,
          eventType: 'EMERGENCY.RELATED_DUPLICATE',
        },
      }),
    ).toBe(1);
    workflowEventId = created.id;
    elevatedEventId = related.id;

    let caregiver = request.agent(server);
    let caregiverCsrf = readCsrfToken(
      await login(caregiver, 'caregiver.demo'),
    );
    const unauthorizedClosure = await caregiver
      .post(`/caregiver/emergencies/${created.id}/resolve`)
      .set('Origin', ORIGIN)
      .set('x-csrf-token', caregiverCsrf)
      .send({
        expectedVersion: 1,
        idempotencyKey: `m04-denied-${randomUUID()}`,
        outcomeCode: 'UNAUTHORIZED_CLOSE_ATTEMPT',
        summary: 'This unassigned caregiver must not close the emergency.',
        familyNotify: false,
        completionChecklist: resolutionChecklist(),
      })
      .expect(404);
    expect(errorCode(unauthorizedClosure)).toBe('RESOURCE_NOT_FOUND');

    const director = request.agent(server);
    const directorLogin = await login(director, 'facility.director');
    const directorCsrf = readCsrfToken(directorLogin);
    const responder = await database.client.staffProfile.findFirstOrThrow({
      where: {
        organizationId: ORGANIZATION_ID,
        facilityId: FACILITY_ID,
        user: { loginName: 'caregiver.demo' },
      },
      select: { id: true },
    });
    const shiftAssignment =
      await database.client.shiftAssignment.findFirstOrThrow({
        where: {
          organizationId: ORGANIZATION_ID,
          facilityId: FACILITY_ID,
          staffProfileId: responder.id,
          status: { in: ['ASSIGNED', 'ACCEPTED'] },
          shift: {
            startsAt: { lte: new Date() },
            endsAt: { gt: new Date() },
            status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
          },
        },
        orderBy: { assignedAt: 'desc' },
        select: { id: true },
      });
    const assignmentRequest = {
      staffProfileId: responder.id,
      shiftAssignmentId: shiftAssignment.id,
      expectedVersion: 1,
      idempotencyKey: `m04-assign-${randomUUID()}`,
      reasonCode: 'CURRENT_SHIFT_RESPONDER',
    };
    const assigned = emergencyAdminDetailSchema.parse(
      (
        await director
          .post(adminPath(`emergencies/${created.id}/responders`))
          .set('Origin', ORIGIN)
          .set('x-csrf-token', directorCsrf)
          .send(assignmentRequest)
          .expect(200)
      ).body,
    );
    expect(assigned.version).toBe(2);
    const assignmentReplay = emergencyAdminDetailSchema.parse(
      (
        await director
          .post(adminPath(`emergencies/${created.id}/responders`))
          .set('Origin', ORIGIN)
          .set('x-csrf-token', directorCsrf)
          .send(assignmentRequest)
          .expect(200)
      ).body,
    );
    expect(assignmentReplay.version).toBe(2);

    const assignmentKeyReuse = await director
      .post(adminPath(`emergencies/${created.id}/responders`))
      .set('Origin', ORIGIN)
      .set('x-csrf-token', directorCsrf)
      .send({
        ...assignmentRequest,
        reasonCode: 'DIFFERENT_ASSIGNMENT_REASON',
      })
      .expect(409);
    expect(errorCode(assignmentKeyReuse)).toBe(
      'EMERGENCY_IDEMPOTENCY_KEY_REUSED',
    );

    const assignmentStaleKey = await director
      .post(adminPath(`emergencies/${created.id}/responders`))
      .set('Origin', ORIGIN)
      .set('x-csrf-token', directorCsrf)
      .send({
        ...assignmentRequest,
        idempotencyKey: `m04-assign-stale-${randomUUID()}`,
      })
      .expect(409);
    expect(errorCode(assignmentStaleKey)).toBe(
      'EMERGENCY_VERSION_CONFLICT',
    );

    const [
      assignmentReceipts,
      assignmentAudits,
      assignmentFacts,
      assignmentEvent,
    ] = await Promise.all([
      database.client.emergencyCommandReceipt.findMany({
        where: {
          organizationId: ORGANIZATION_ID,
          commandKind: 'RESPONDER_ASSIGN',
          resourceType: 'EMERGENCY_EVENT',
          resourceId: created.id,
        },
      }),
      database.client.auditEvent.count({
        where: {
          organizationId: ORGANIZATION_ID,
          facilityId: FACILITY_ID,
          action: 'EMERGENCY.RESPONDER_ASSIGN',
          resourceType: 'EMERGENCY_EVENT',
          resourceId: created.id,
        },
      }),
      database.client.emergencyResponderAssignment.findMany({
        where: { emergencyEventId: created.id },
      }),
      database.client.emergencyEvent.findUniqueOrThrow({
        where: { id: created.id },
        select: { version: true },
      }),
    ]);
    expect(assignmentReceipts).toHaveLength(1);
    expect(assignmentReceipts[0]).toMatchObject({
      idempotencyKey: assignmentRequest.idempotencyKey,
      resultVersion: 2,
    });
    expect(assignmentReceipts[0]?.requestFingerprint).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(assignmentAudits).toBe(1);
    expect(assignmentFacts).toHaveLength(1);
    expect(assignmentEvent.version).toBe(2);

    const directorRole =
      await database.client.userRole.findFirstOrThrow({
        where: {
          organizationId: ORGANIZATION_ID,
          user: { loginName: 'facility.director' },
          revokedAt: null,
          role: {
            rolePermissions: {
              some: {
                permission: { code: 'emergency.assign' },
              },
            },
          },
        },
        select: { roleId: true },
      });
    const assignPermission =
      await database.client.permission.findUniqueOrThrow({
        where: { code: 'emergency.assign' },
        select: { id: true },
      });
    await database.client.rolePermission.delete({
      where: {
        roleId_permissionId: {
          roleId: directorRole.roleId,
          permissionId: assignPermission.id,
        },
      },
    });
    try {
      const revokedReplay = await director
        .post(adminPath(`emergencies/${created.id}/responders`))
        .set('Origin', ORIGIN)
        .set('x-csrf-token', directorCsrf)
        .send(assignmentRequest);
      expect([401, 403, 404]).toContain(revokedReplay.status);
    } finally {
      await database.client.rolePermission.create({
        data: {
          roleId: directorRole.roleId,
          permissionId: assignPermission.id,
        },
      });
    }

    const caregiverRole = await database.client.userRole.findFirstOrThrow({
      where: {
        organizationId: ORGANIZATION_ID,
        user: { loginName: 'caregiver.demo' },
        role: { code: 'CAREGIVER' },
        revokedAt: null,
      },
      select: {
        id: true,
        roleId: true,
        dataScopes: {
          where: {
            kind: 'ACTIVE_SHIFT',
            scopeKey: { contains: shiftAssignment.id },
          },
          select: { id: true, validUntil: true },
        },
      },
    });
    const activeShiftScope = caregiverRole.dataScopes[0];
    if (activeShiftScope === undefined) {
      throw new Error('Seeded caregiver active-shift scope was missing');
    }
    const deniedAck = () =>
      caregiver
        .post(`/caregiver/emergencies/${created.id}/acknowledge`)
        .set('Origin', ORIGIN)
        .set('x-csrf-token', caregiverCsrf)
        .send({
          expectedVersion: 2,
          idempotencyKey: `m04-toctou-${randomUUID()}`,
          reasonCode: 'CAREGIVER_ACKNOWLEDGED',
        });

    await database.client.userRole.update({
      where: { id: caregiverRole.id },
      data: { revokedAt: new Date() },
    });
    try {
      expect([401, 403, 404]).toContain((await deniedAck()).status);
    } finally {
      await database.client.userRole.update({
        where: { id: caregiverRole.id },
        data: { revokedAt: null },
      });
    }
    caregiver = request.agent(server);
    caregiverCsrf = readCsrfToken(
      await login(caregiver, 'caregiver.demo'),
    );

    await database.client.dataScope.update({
      where: { id: activeShiftScope.id },
      data: { validUntil: new Date(Date.now() - 1_000) },
    });
    try {
      expect([401, 403, 404]).toContain((await deniedAck()).status);
    } finally {
      await database.client.dataScope.update({
        where: { id: activeShiftScope.id },
        data: { validUntil: activeShiftScope.validUntil },
      });
    }
    caregiver = request.agent(server);
    caregiverCsrf = readCsrfToken(
      await login(caregiver, 'caregiver.demo'),
    );

    const acknowledgePermission =
      await database.client.permission.findUniqueOrThrow({
        where: { code: 'emergency.acknowledge' },
        select: { id: true },
      });
    await database.client.rolePermission.delete({
      where: {
        roleId_permissionId: {
          roleId: caregiverRole.roleId,
          permissionId: acknowledgePermission.id,
        },
      },
    });
    try {
      expect([401, 403, 404]).toContain((await deniedAck()).status);
    } finally {
      await database.client.rolePermission.create({
        data: {
          roleId: caregiverRole.roleId,
          permissionId: acknowledgePermission.id,
        },
      });
    }
    caregiver = request.agent(server);
    caregiverCsrf = readCsrfToken(
      await login(caregiver, 'caregiver.demo'),
    );

    const futureAcknowledgement = await caregiver
      .post(`/caregiver/emergencies/${created.id}/acknowledge`)
      .set('Origin', ORIGIN)
      .set('x-csrf-token', caregiverCsrf)
      .send({
        expectedVersion: 2,
        idempotencyKey: `m04-future-ack-${randomUUID()}`,
        reasonCode: 'CAREGIVER_ACKNOWLEDGED',
        clientObservedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .expect(400);
    expect(errorCode(futureAcknowledgement)).toBe(
      'EMERGENCY_CLIENT_OBSERVED_AT_IN_FUTURE',
    );
    expect(
      await database.client.emergencyEvent.findUniqueOrThrow({
        where: { id: created.id },
        select: { status: true, version: true },
      }),
    ).toEqual({ status: 'OPEN', version: 2 });

    const competingAcks = [
      {
        expectedVersion: 2,
        idempotencyKey: `m04-ack-a-${randomUUID()}`,
        reasonCode: 'CAREGIVER_ACKNOWLEDGED',
      },
      {
        expectedVersion: 2,
        idempotencyKey: `m04-ack-b-${randomUUID()}`,
        reasonCode: 'CAREGIVER_ACKNOWLEDGED',
      },
    ];
    const responses = await Promise.all(
      competingAcks.map((body) =>
        caregiver
          .post(`/caregiver/emergencies/${created.id}/acknowledge`)
          .set('Origin', ORIGIN)
          .set('x-csrf-token', caregiverCsrf)
          .send(body),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    const winningIndex = responses.findIndex(
      (response) => response.status === 200,
    );
    const winningRequest = competingAcks[winningIndex];
    if (winningRequest === undefined) {
      throw new Error('No acknowledgement command won the CAS race');
    }
    const acknowledged = caregiverEmergencySchema.parse(
      responses[winningIndex]?.body,
    );
    expect(acknowledged.status).toBe('ACKNOWLEDGED');
    expect(acknowledged.version).toBe(3);

    const idempotentReplay = caregiverEmergencySchema.parse(
      (
        await caregiver
          .post(`/caregiver/emergencies/${created.id}/acknowledge`)
          .set('Origin', ORIGIN)
          .set('x-csrf-token', caregiverCsrf)
          .send(winningRequest)
          .expect(200)
      ).body,
    );
    expect(idempotentReplay.version).toBe(3);

    const reusedKey = await caregiver
      .post(`/caregiver/emergencies/${created.id}/acknowledge`)
      .set('Origin', ORIGIN)
      .set('x-csrf-token', caregiverCsrf)
      .send({
        ...winningRequest,
        reasonCode: 'CHANGED_ACKNOWLEDGEMENT_REASON',
      })
      .expect(409);
    expect(errorCode(reusedKey)).toBe('EMERGENCY_IDEMPOTENCY_KEY_REUSED');

    const [acknowledgements, transitions, outboxEvents] = await Promise.all([
      database.client.emergencyAcknowledgement.count({
        where: { emergencyEventId: created.id },
      }),
      database.client.emergencyTransition.count({
        where: {
          emergencyEventId: created.id,
          toStatus: 'ACKNOWLEDGED',
        },
      }),
      database.client.outboxEvent.count({
        where: {
          aggregateId: created.id,
          eventType: 'EMERGENCY.ACKNOWLEDGED',
        },
      }),
    ]);
    expect({
      acknowledgements,
      transitions,
      outboxEvents,
    }).toEqual({
      acknowledgements: 1,
      transitions: 1,
      outboxEvents: 1,
    });
  });

  it('preserves immutable regular and elevated responder assignment facts across reassignment', async () => {
    const elder = request.agent(server);
    const elderCsrf = readCsrfToken(
      await login(elder, 'elder.demo'),
    );
    const event = elderEmergencyStatusSchema.parse(
      (
        await elder
          .post('/elder/emergencies')
          .set('Origin', ORIGIN)
          .set('x-csrf-token', elderCsrf)
          .send({
            externalEventId: `m04-reassign-${randomUUID()}`,
            idempotencyKey: `m04-reassign-create-${randomUUID()}`,
            reasonCode: 'REASSIGNMENT_HISTORY_TEST',
          })
          .expect(200)
      ).body,
    );

    const regularAssignment =
      await database.client.shiftAssignment.findFirstOrThrow({
        where: {
          organizationId: ORGANIZATION_ID,
          facilityId: FACILITY_ID,
          staffProfile: { user: { loginName: 'caregiver.demo' } },
          status: { in: ['ASSIGNED', 'ACCEPTED'] },
          shift: {
            startsAt: { lte: new Date() },
            endsAt: { gt: new Date() },
            status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
            teamId: { not: null },
          },
        },
        include: {
          staffProfile: { include: { user: true } },
          shift: true,
        },
      });
    const stay = await database.client.elderStay.findFirstOrThrow({
      where: {
        elderId: ELDER_ID,
        organizationId: ORGANIZATION_ID,
        facilityId: FACILITY_ID,
        status: 'ACTIVE',
      },
      include: { bed: { include: { room: true } } },
    });
    const candidates = await database.client.shiftAssignment.findMany({
      where: {
        organizationId: ORGANIZATION_ID,
        facilityId: FACILITY_ID,
        staffProfileId: { not: regularAssignment.staffProfileId },
        status: { in: ['ASSIGNED', 'ACCEPTED'] },
        shift: {
          startsAt: { lte: new Date() },
          endsAt: { gt: new Date() },
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
          teamId: { not: null },
        },
      },
      include: {
        staffProfile: { include: { user: true } },
        shift: true,
        scopes: true,
        elderAssignments: true,
      },
    });
    const elevatedAssignment = candidates.find(
      (assignment) =>
        !assignment.elderAssignments.some(
          (elderAssignment) => elderAssignment.elderId === ELDER_ID,
        ) &&
        !assignment.scopes.some(
          (scope) =>
            scope.kind === 'FACILITY' ||
            (scope.kind === 'FLOOR' &&
              scope.floorId === stay.bed.room.floorId) ||
            (scope.kind === 'ZONE' &&
              scope.zoneId === stay.bed.room.zoneId),
        ),
    );
    if (elevatedAssignment === undefined) {
      throw new Error(
        'No active out-of-scope assignment exists for elevation history',
      );
    }

    const director = request.agent(server);
    const directorCsrf = readCsrfToken(
      await login(director, 'facility.director'),
    );
    const regularReason = 'REGULAR_SCOPE_ASSIGNMENT';
    const elevatedReason = 'SUPERVISOR_REASSIGNMENT';
    const elevationReason = 'URGENT_OUT_OF_SCOPE_REASSIGNMENT';
    const first = emergencyAdminDetailSchema.parse(
      (
        await director
          .post(adminPath(`emergencies/${event.id}/responders`))
          .set('Origin', ORIGIN)
          .set('x-csrf-token', directorCsrf)
          .send({
            staffProfileId: regularAssignment.staffProfileId,
            shiftAssignmentId: regularAssignment.id,
            expectedVersion: 1,
            idempotencyKey: `m04-regular-assignment-${randomUUID()}`,
            reasonCode: regularReason,
          })
          .expect(200)
      ).body,
    );
    expect(first.version).toBe(2);

    const second = emergencyAdminDetailSchema.parse(
      (
        await director
          .post(adminPath(`emergencies/${event.id}/responders`))
          .set('Origin', ORIGIN)
          .set('x-csrf-token', directorCsrf)
          .send({
            staffProfileId: elevatedAssignment.staffProfileId,
            shiftAssignmentId: elevatedAssignment.id,
            expectedVersion: 2,
            idempotencyKey: `m04-elevated-reassignment-${randomUUID()}`,
            reasonCode: elevatedReason,
            emergencyElevationReasonCode: elevationReason,
          })
          .expect(200)
      ).body,
    );
    expect(second.version).toBe(3);

    const [facts, responders, receipts, audits] = await Promise.all([
      database.client.emergencyResponderAssignment.findMany({
        where: { emergencyEventId: event.id },
        orderBy: { toVersion: 'asc' },
      }),
      database.client.emergencyResponder.findMany({
        where: { emergencyEventId: event.id },
      }),
      database.client.emergencyCommandReceipt.count({
        where: {
          commandKind: 'RESPONDER_ASSIGN',
          resourceType: 'EMERGENCY_EVENT',
          resourceId: event.id,
        },
      }),
      database.client.auditEvent.count({
        where: {
          action: 'EMERGENCY.RESPONDER_ASSIGN',
          resourceId: event.id,
        },
      }),
    ]);
    expect(facts).toHaveLength(2);
    expect(facts[0]).toMatchObject({
      staffProfileId: regularAssignment.staffProfileId,
      shiftAssignmentId: regularAssignment.id,
      teamId: regularAssignment.shift.teamId,
      fromVersion: 1,
      toVersion: 2,
      reasonCode: regularReason,
      isEmergencyElevation: false,
      elevationReasonCode: null,
      elevationExpiresAt: null,
    });
    expect(facts[1]).toMatchObject({
      staffProfileId: elevatedAssignment.staffProfileId,
      shiftAssignmentId: elevatedAssignment.id,
      teamId: elevatedAssignment.shift.teamId,
      fromVersion: 2,
      toVersion: 3,
      reasonCode: elevatedReason,
      isEmergencyElevation: true,
      elevationReasonCode: elevationReason,
    });
    expect(facts[1]?.elevationExpiresAt).not.toBeNull();
    expect(
      facts[1]?.elevationExpiresAt?.getTime(),
    ).toBeGreaterThan(facts[1]?.assignedAt.getTime() ?? Number.MAX_VALUE);

    const released = responders.find(
      (responder) =>
        responder.staffProfileId === regularAssignment.staffProfileId,
    );
    const active = responders.find(
      (responder) =>
        responder.staffProfileId === elevatedAssignment.staffProfileId,
    );
    expect(released).toMatchObject({
      status: 'RELEASED',
      acknowledgedAt: null,
    });
    expect(released?.releasedAt?.toISOString()).toBe(
      facts[1]?.assignedAt.toISOString(),
    );
    expect(active).toMatchObject({
      status: 'ASSIGNED',
      acknowledgedAt: null,
      isEmergencyElevation: true,
      elevationReasonCode: elevationReason,
    });
    expect(active?.assignedAt.toISOString()).toBe(
      facts[1]?.assignedAt.toISOString(),
    );
    expect(active?.elevationExpiresAt?.toISOString()).toBe(
      facts[1]?.elevationExpiresAt?.toISOString(),
    );
    expect(receipts).toBe(2);
    expect(audits).toBe(2);
  });

  it('enforces ordered milestones and completes ACKNOWLEDGED through REVIEWED with fixed evidence', async () => {
    if (workflowEventId.length === 0) {
      throw new Error('The workflow fixture was not created');
    }
    const caregiver = request.agent(server);
    const caregiverCsrf = readCsrfToken(
      await login(caregiver, 'caregiver.demo'),
    );
    const director = request.agent(server);
    const directorCsrf = readCsrfToken(
      await login(director, 'facility.director'),
    );

    const futureEnRoute = await caregiver
      .post(`/caregiver/emergencies/${workflowEventId}/milestones`)
      .set('Origin', ORIGIN)
      .set('x-csrf-token', caregiverCsrf)
      .send({
        kind: 'EN_ROUTE',
        expectedVersion: 3,
        idempotencyKey: `m04-future-en-route-${randomUUID()}`,
        reasonCode: 'CAREGIVER_EN_ROUTE',
        clientObservedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .expect(400);
    expect(errorCode(futureEnRoute)).toBe(
      'EMERGENCY_CLIENT_OBSERVED_AT_IN_FUTURE',
    );
    expect(
      await database.client.emergencyEvent.findUniqueOrThrow({
        where: { id: workflowEventId },
        select: { status: true, version: true },
      }),
    ).toEqual({ status: 'ACKNOWLEDGED', version: 3 });

    const skippedOnSite = await caregiver
      .post(`/caregiver/emergencies/${workflowEventId}/milestones`)
      .set('Origin', ORIGIN)
      .set('x-csrf-token', caregiverCsrf)
      .send({
        kind: 'ON_SITE',
        expectedVersion: 3,
        idempotencyKey: `m04-skip-site-${randomUUID()}`,
        reasonCode: 'INVALID_SKIPPED_MILESTONE',
      })
      .expect(409);
    expect(errorCode(skippedOnSite)).toBe('ON_SITE_NOT_ALLOWED');

    const skippedReview = await director
      .post(adminPath(`emergencies/${workflowEventId}/review`))
      .set('Origin', ORIGIN)
      .set('x-csrf-token', directorCsrf)
      .send({
        expectedVersion: 3,
        idempotencyKey: `m04-skip-review-${randomUUID()}`,
        kind: 'COMPLETED',
        summary: 'A review cannot happen before a human resolution.',
      })
      .expect(409);
    expect(errorCode(skippedReview)).toBe('INVALID_EMERGENCY_TRANSITION');

    const enRoute = caregiverEmergencySchema.parse(
      (
        await caregiver
          .post(`/caregiver/emergencies/${workflowEventId}/milestones`)
          .set('Origin', ORIGIN)
          .set('x-csrf-token', caregiverCsrf)
          .send({
            kind: 'EN_ROUTE',
            expectedVersion: 3,
            idempotencyKey: `m04-en-route-${randomUUID()}`,
            reasonCode: 'CAREGIVER_EN_ROUTE',
          })
          .expect(200)
      ).body,
    );
    expect({ status: enRoute.status, version: enRoute.version }).toEqual({
      status: 'RESPONDING',
      version: 4,
    });

    const beforeOnSite = await caregiver
      .post(`/caregiver/emergencies/${workflowEventId}/resolve`)
      .set('Origin', ORIGIN)
      .set('x-csrf-token', caregiverCsrf)
      .send({
        expectedVersion: 4,
        idempotencyKey: `m04-too-early-${randomUUID()}`,
        outcomeCode: 'SAFE_WITH_FOLLOW_UP',
        summary: 'Resolution is blocked until the responder records on-site.',
        familyNotify: false,
        completionChecklist: resolutionChecklist(),
      })
      .expect(409);
    expect(errorCode(beforeOnSite)).toBe('EMERGENCY_ON_SITE_REQUIRED');

    const onSite = caregiverEmergencySchema.parse(
      (
        await caregiver
          .post(`/caregiver/emergencies/${workflowEventId}/milestones`)
          .set('Origin', ORIGIN)
          .set('x-csrf-token', caregiverCsrf)
          .send({
            kind: 'ON_SITE',
            expectedVersion: 4,
            idempotencyKey: `m04-on-site-${randomUUID()}`,
            reasonCode: 'CAREGIVER_ON_SITE',
          })
          .expect(200)
      ).body,
    );
    expect({ status: onSite.status, version: onSite.version }).toEqual({
      status: 'RESPONDING',
      version: 5,
    });

    const resolved = caregiverEmergencySchema.parse(
      (
        await caregiver
          .post(`/caregiver/emergencies/${workflowEventId}/resolve`)
          .set('Origin', ORIGIN)
          .set('x-csrf-token', caregiverCsrf)
          .send({
            expectedVersion: 5,
            idempotencyKey: `m04-resolve-${randomUUID()}`,
            outcomeCode: 'SAFE_WITH_FOLLOW_UP',
            summary: '现场安全、老人状态与后续交接均已由在场人员确认。',
            familyNotify: true,
            completionChecklist: resolutionChecklist(),
          })
          .expect(200)
      ).body,
    );
    expect({ status: resolved.status, version: resolved.version }).toEqual({
      status: 'RESOLVED',
      version: 6,
    });

    const reviewed = emergencyAdminDetailSchema.parse(
      (
        await director
          .post(adminPath(`emergencies/${workflowEventId}/review`))
          .set('Origin', ORIGIN)
          .set('x-csrf-token', directorCsrf)
          .send({
            expectedVersion: 6,
            idempotencyKey: `m04-review-${randomUUID()}`,
            kind: 'COMPLETED',
            summary: '主管确认响应、处置和交接证据完整。',
          })
          .expect(200)
      ).body,
    );
    expect({ status: reviewed.status, version: reviewed.version }).toEqual({
      status: 'REVIEWED',
      version: 7,
    });
    expect(reviewed.resolution?.completionChecklist).toEqual(
      reviewed.requiredResolutionChecklistCodes,
    );

    const persistedResolution =
      await database.client.emergencyResolution.findUniqueOrThrow({
        where: { emergencyEventId: workflowEventId },
        select: { completionChecklist: true },
      });
    const checklistSnapshot = jsonObject(
      persistedResolution.completionChecklist,
    );
    expect(checklistSnapshot['schemaVersion']).toBe(1);
    expect(checklistSnapshot['expectedCodes']).toEqual([
      'SCENE_SAFETY_CONFIRMED',
      'ELDER_STATE_CONFIRMED',
      'FOLLOW_UP_HANDOFF_CONFIRMED',
    ]);
    expect(
      Array.isArray(checklistSnapshot['confirmations']) &&
        checklistSnapshot['confirmations'].every(
          (confirmation) =>
            typeof confirmation === 'object' &&
            confirmation !== null &&
            !Array.isArray(confirmation) &&
            jsonObject(confirmation)['confirmed'] === true,
        ),
    ).toBe(true);

    const [transitions, audits, outbox, timeline, pendingEscalations] =
      await Promise.all([
        database.client.emergencyTransition.findMany({
          where: { emergencyEventId: workflowEventId },
          orderBy: { toVersion: 'asc' },
          select: { toStatus: true, actorType: true },
        }),
        database.client.auditEvent.count({
          where: {
            resourceId: workflowEventId,
            action: {
              in: [
                'EMERGENCY.RESPONDER_ASSIGN',
                'EMERGENCY.ACKNOWLEDGED',
                'EMERGENCY.MARK_EN_ROUTE',
                'EMERGENCY.MARK_ON_SITE',
                'EMERGENCY.RESOLVE',
                'EMERGENCY.REVIEW',
              ],
            },
          },
        }),
        database.client.outboxEvent.findMany({
          where: {
            aggregateId: workflowEventId,
            eventType: { startsWith: 'EMERGENCY.' },
          },
          orderBy: { aggregateVersion: 'asc' },
          select: { eventType: true, payload: true },
        }),
        database.client.elderTimelineEntry.count({
          where: {
            sourceResourceId: workflowEventId,
            sourceResourceType: 'EMERGENCY_EVENT',
          },
        }),
        database.client.emergencyEscalation.count({
          where: {
            emergencyEventId: workflowEventId,
            status: { in: ['SCHEDULED', 'FAILED'] },
          },
        }),
      ]);
    expect(transitions.map((transition) => transition.toStatus)).toEqual([
      'OPEN',
      'ACKNOWLEDGED',
      'RESPONDING',
      'RESOLVED',
      'REVIEWED',
    ]);
    expect(
      transitions
        .filter((transition) =>
          ['RESOLVED', 'REVIEWED'].includes(transition.toStatus),
        )
        .every((transition) => transition.actorType === 'USER'),
    ).toBe(true);
    expect(audits).toBe(6);
    expect(outbox.map((event) => event.eventType)).toEqual([
      'EMERGENCY.OPENED',
      'EMERGENCY.ACKNOWLEDGED',
      'EMERGENCY.RESPONDING',
      'EMERGENCY.RESPONDING',
      'EMERGENCY.RESOLVED',
      'EMERGENCY.REVIEWED',
    ]);
    expect(
      outbox.every((event) => {
        const payload = jsonObject(event.payload);
        return (
          payload['emergencyId'] === workflowEventId &&
          payload['elderId'] === ELDER_ID &&
          typeof payload['status'] === 'string' &&
          typeof payload['version'] === 'number' &&
          typeof payload['reasonCode'] === 'string' &&
          !('emergencyEventId' in payload)
        );
      }),
    ).toBe(true);
    expect(timeline).toBe(7);
    expect(pendingEscalations).toBe(0);
  });

  it('rejects expired shifts and expired emergency elevation', async () => {
    if (elevatedEventId.length === 0) {
      throw new Error('The elevation fixture was not created');
    }
    const director = request.agent(server);
    const directorCsrf = readCsrfToken(
      await login(director, 'facility.director'),
    );
    const regularAssignment =
      await database.client.shiftAssignment.findFirstOrThrow({
        where: {
          organizationId: ORGANIZATION_ID,
          facilityId: FACILITY_ID,
          staffProfile: { user: { loginName: 'caregiver.demo' } },
          shift: {
            startsAt: { lte: new Date() },
            endsAt: { gt: new Date() },
            status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
          },
        },
        include: {
          staffProfile: { include: { user: true } },
          shift: true,
        },
      });
    const originalShift = {
      endsAt: regularAssignment.shift.endsAt,
      status: regularAssignment.shift.status,
    };
    await database.client.shift.update({
      where: { id: regularAssignment.shift.id },
      data: {
        endsAt: new Date(Date.now() - 1_000),
        status: 'COMPLETED',
      },
    });
    try {
      await director
        .post(adminPath(`emergencies/${elevatedEventId}/responders`))
        .set('Origin', ORIGIN)
        .set('x-csrf-token', directorCsrf)
        .send({
          staffProfileId: regularAssignment.staffProfileId,
          shiftAssignmentId: regularAssignment.id,
          expectedVersion: 1,
          idempotencyKey: `m04-expired-shift-${randomUUID()}`,
          reasonCode: 'EXPIRED_SHIFT_MUST_FAIL',
        })
        .expect(404);
    } finally {
      await database.client.shift.update({
        where: { id: regularAssignment.shift.id },
        data: originalShift,
      });
    }

    const stay = await database.client.elderStay.findFirstOrThrow({
      where: {
        elderId: ELDER_ID,
        organizationId: ORGANIZATION_ID,
        facilityId: FACILITY_ID,
        status: 'ACTIVE',
      },
      include: { bed: { include: { room: true } } },
    });
    const activeAssignments =
      await database.client.shiftAssignment.findMany({
        where: {
          organizationId: ORGANIZATION_ID,
          facilityId: FACILITY_ID,
          staffProfile: {
            user: { loginName: { not: 'caregiver.demo' } },
          },
          status: { in: ['ASSIGNED', 'ACCEPTED'] },
          shift: {
            startsAt: { lte: new Date() },
            endsAt: { gt: new Date() },
            status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
            teamId: { not: null },
          },
        },
        include: {
          staffProfile: { include: { user: true } },
          shift: true,
          scopes: true,
          elderAssignments: true,
        },
      });
    const elevatedAssignment = activeAssignments.find(
      (assignment) =>
        !assignment.elderAssignments.some(
          (elderAssignment) => elderAssignment.elderId === ELDER_ID,
        ) &&
        !assignment.scopes.some(
          (scope) =>
            scope.kind === 'FACILITY' ||
            (scope.kind === 'FLOOR' &&
              scope.floorId === stay.bed.room.floorId) ||
            (scope.kind === 'ZONE' &&
              scope.zoneId === stay.bed.room.zoneId),
        ),
    );
    if (elevatedAssignment === undefined) {
      throw new Error('No active out-of-scope caregiver fixture was available');
    }
    const elevated = emergencyAdminDetailSchema.parse(
      (
        await director
          .post(adminPath(`emergencies/${elevatedEventId}/responders`))
          .set('Origin', ORIGIN)
          .set('x-csrf-token', directorCsrf)
          .send({
            staffProfileId: elevatedAssignment.staffProfileId,
            shiftAssignmentId: elevatedAssignment.id,
            expectedVersion: 1,
            idempotencyKey: `m04-elevation-${randomUUID()}`,
            reasonCode: 'SUPERVISOR_EMERGENCY_ELEVATION',
            emergencyElevationReasonCode: 'IMMEDIATE_RESPONSE_NEEDED',
          })
          .expect(200)
      ).body,
    );
    expect(elevated.currentResponder?.isEmergencyElevation).toBe(true);
    await database.client.emergencyResponder.updateMany({
      where: {
        emergencyEventId: elevatedEventId,
        staffProfileId: elevatedAssignment.staffProfileId,
      },
      data: {
        assignedAt: new Date(Date.now() - 30 * 60 * 1_000),
        elevationExpiresAt: new Date(Date.now() - 60 * 1_000),
      },
    });

    const elevatedCaregiver = request.agent(server);
    const elevatedCaregiverCsrf = readCsrfToken(
      await login(
        elevatedCaregiver,
        elevatedAssignment.staffProfile.user.loginName,
      ),
    );
    const expiredElevation = await elevatedCaregiver
      .post(`/caregiver/emergencies/${elevatedEventId}/acknowledge`)
      .set('Origin', ORIGIN)
      .set('x-csrf-token', elevatedCaregiverCsrf)
      .send({
        expectedVersion: 2,
        idempotencyKey: `m04-expired-elevation-${randomUUID()}`,
        reasonCode: 'EXPIRED_ELEVATION_MUST_FAIL',
      });
    expect([403, 404]).toContain(expiredElevation.status);
    expect(
      await database.client.emergencyAcknowledgement.count({
        where: { emergencyEventId: elevatedEventId },
      }),
    ).toBe(0);
  });

  it('returns tenant-safe 404s and never projects stale, fallback or missing location as current', async () => {
    const director = request.agent(server);
    await login(director, 'facility.director');
    await director
      .get(
        `/admin/organizations/${ORGANIZATION_ID}/facilities/${EAST_FACILITY_ID}/emergencies/${SEEDED_OVERDUE_EVENT_ID}`,
      )
      .expect(404);
    await director
      .get(
        `/admin/organizations/${SONGHE_ORGANIZATION_ID}/facilities/${SONGHE_FACILITY_ID}/emergencies/${SEEDED_OVERDUE_EVENT_ID}`,
      )
      .expect(404);

    const [overdue, roomFallback, unknown] = await Promise.all([
      director
        .get(adminPath(`emergencies/${SEEDED_OVERDUE_EVENT_ID}`))
        .expect(200),
      director
        .get(adminPath(`emergencies/${SEEDED_REVIEWED_EVENT_ID}`))
        .expect(200),
      director
        .get(adminPath(`emergencies/${SEEDED_UNKNOWN_EVENT_ID}`))
        .expect(200),
    ]);
    const staleProjection = emergencyAdminDetailSchema.parse(overdue.body);
    const roomProjection = emergencyAdminDetailSchema.parse(roomFallback.body);
    const unknownProjection = emergencyAdminDetailSchema.parse(unknown.body);
    expect({
      state: staleProjection.location.state,
      accuracyMeters: staleProjection.location.accuracyMeters,
    }).toEqual({ state: 'STALE', accuracyMeters: null });
    expect({
      state: roomProjection.location.state,
      accuracyMeters: roomProjection.location.accuracyMeters,
    }).toEqual({ state: 'ROOM_FALLBACK', accuracyMeters: null });
    expect(roomProjection.location.label).toContain('非实时位置');
    expect({
      state: unknownProjection.location.state,
      accuracyMeters: unknownProjection.location.accuracyMeters,
    }).toEqual({ state: 'UNKNOWN', accuracyMeters: null });

    const policy = await database.client.escalationPolicy.findFirstOrThrow({
      where: {
        organizationId: ORGANIZATION_ID,
        facilityId: FACILITY_ID,
        status: 'ACTIVE',
      },
      orderBy: { version: 'desc' },
    });
    const supervisor = await database.client.user.findFirstOrThrow({
      where: { loginName: 'facility.director' },
      select: { id: true },
    });
    const noLocationEvent = await database.client.emergencyEvent.create({
      data: {
        id: randomUUID(),
        organizationId: ORGANIZATION_ID,
        facilityId: FACILITY_ID,
        elderId: ELDER_ID,
        sourceKind: 'STAFF_MANUAL',
        reasonCode: 'INTEGRATION_MISSING_LOCATION',
        status: 'OPEN',
        version: 1,
        escalationPolicyId: policy.id,
        escalationPolicyVersion: policy.version,
        openedAt: new Date(),
        correlationId: `m04-missing-location-${randomUUID()}`,
      },
    });
    await database.client.emergencyTransition.create({
      data: {
        organizationId: ORGANIZATION_ID,
        facilityId: FACILITY_ID,
        emergencyEventId: noLocationEvent.id,
        fromStatus: null,
        toStatus: 'OPEN',
        fromVersion: 0,
        toVersion: 1,
        actorType: 'USER',
        actorUserId: supervisor.id,
        reasonCode: 'INTEGRATION_MISSING_LOCATION',
        correlationId: noLocationEvent.correlationId,
        occurredAt: noLocationEvent.openedAt,
      },
    });
    const missingProjection = emergencyAdminDetailSchema.parse(
      (
        await director
          .get(adminPath(`emergencies/${noLocationEvent.id}`))
          .expect(200)
      ).body,
    );
    expect(missingProjection.location).toMatchObject({
      state: 'UNKNOWN',
      source: 'NONE',
      accuracyMeters: null,
      fallbackReasonCode: 'LOCATION_UNAVAILABLE',
    });
    const unknownPage = emergencyAdminPageSchema.parse(
      (
        await director
          .get(adminPath('emergencies'))
          .query({
            page: 1,
            pageSize: 100,
            locationState: 'UNKNOWN',
          })
          .expect(200)
      ).body,
    );
    expect(
      unknownPage.items.some((item) => item.id === noLocationEvent.id),
    ).toBe(true);
    expect(
      unknownPage.items.every((item) => item.location.state === 'UNKNOWN'),
    ).toBe(true);
  });

  it('reads an absent family preference at version zero and enforces receipt-backed update idempotency', async () => {
    await database.client.familyEmergencyNotificationPreference.deleteMany({
      where: {
        organizationId: ORGANIZATION_ID,
        facilityId: FACILITY_ID,
        elderId: ELDER_ID,
        familyRelationshipId: FAMILY_RELATIONSHIP_ID,
      },
    });

    const family = request.agent(server);
    const familyCsrf = readCsrfToken(
      await login(family, 'family.demo'),
    );
    const emptyPreference =
      familyEmergencyNotificationPreferenceSchema.parse(
        (
          await family
            .get(
              `/family/elders/${ELDER_ID}/emergency-notification-preference`,
            )
            .expect(200)
        ).body,
      );
    expect(emptyPreference).toMatchObject({
      id: null,
      elderId: ELDER_ID,
      version: 0,
      updatedAt: null,
    });

    const updateKey = `m04-family-preference-${randomUUID()}`;
    const firstUpdateRequest = {
      expectedVersion: 0,
      idempotencyKey: updateKey,
      enabled: true,
      notifyOnOpened: true,
      notifyOnResolved: false,
      channel: 'EMAIL',
    } as const;
    const updated = familyEmergencyNotificationPreferenceSchema.parse(
      (
        await family
          .put(
            `/family/elders/${ELDER_ID}/emergency-notification-preference`,
          )
          .set('Origin', ORIGIN)
          .set('x-csrf-token', familyCsrf)
          .send(firstUpdateRequest)
          .expect(200)
      ).body,
    );
    expect(updated).toMatchObject({
      elderId: ELDER_ID,
      enabled: true,
      notifyOnOpened: true,
      notifyOnResolved: false,
      channel: 'EMAIL',
      version: 1,
    });

    const replay = familyEmergencyNotificationPreferenceSchema.parse(
      (
        await family
          .put(
            `/family/elders/${ELDER_ID}/emergency-notification-preference`,
          )
          .set('Origin', ORIGIN)
          .set('x-csrf-token', familyCsrf)
          .send(firstUpdateRequest)
          .expect(200)
      ).body,
    );
    expect(replay).toEqual(updated);

    const reusedKey = await family
      .put(
        `/family/elders/${ELDER_ID}/emergency-notification-preference`,
      )
      .set('Origin', ORIGIN)
      .set('x-csrf-token', familyCsrf)
      .send({
        ...firstUpdateRequest,
        notifyOnResolved: true,
      })
      .expect(409);
    expect(errorCode(reusedKey)).toBe(
      'EMERGENCY_IDEMPOTENCY_KEY_REUSED',
    );

    const staleKey = `m04-family-preference-stale-${randomUUID()}`;
    const staleUpdate = await family
      .put(
        `/family/elders/${ELDER_ID}/emergency-notification-preference`,
      )
      .set('Origin', ORIGIN)
      .set('x-csrf-token', familyCsrf)
      .send({
        ...firstUpdateRequest,
        idempotencyKey: staleKey,
      })
      .expect(409);
    expect(errorCode(staleUpdate)).toBe(
      'EMERGENCY_PREFERENCE_VERSION_CONFLICT',
    );

    const familyUser = await database.client.user.findUniqueOrThrow({
      where: { normalizedLoginName: 'family.demo' },
      select: { id: true },
    });
    const [receipts, preference, audits] = await Promise.all([
      database.client.emergencyCommandReceipt.findMany({
        where: {
          organizationId: ORGANIZATION_ID,
          actorUserId: familyUser.id,
          commandKind: 'FAMILY_NOTIFICATION_PREFERENCE_UPDATE',
          idempotencyKey: { in: [updateKey, staleKey] },
        },
      }),
      database.client.familyEmergencyNotificationPreference.findFirstOrThrow(
        {
          where: {
            organizationId: ORGANIZATION_ID,
            facilityId: FACILITY_ID,
            elderId: ELDER_ID,
            familyRelationshipId: FAMILY_RELATIONSHIP_ID,
          },
        },
      ),
      database.client.auditEvent.findMany({
        where: {
          organizationId: ORGANIZATION_ID,
          facilityId: FACILITY_ID,
          action: 'EMERGENCY.NOTIFICATION_PREFERENCE_UPDATE',
          actorUserId: familyUser.id,
        },
      }),
    ]);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      idempotencyKey: updateKey,
      resourceType: 'FAMILY_EMERGENCY_NOTIFICATION_PREFERENCE',
      resourceId: ELDER_ID,
      resultVersion: 1,
    });
    expect(preference.version).toBe(1);
    expect(
      audits.filter((audit) => audit.resourceId === preference.id),
    ).toHaveLength(1);

    await database.client.familyRelationship.update({
      where: { id: FAMILY_RELATIONSHIP_ID },
      data: { revokedAt: new Date() },
    });
    try {
      await family
        .put(
          `/family/elders/${ELDER_ID}/emergency-notification-preference`,
        )
        .set('Origin', ORIGIN)
        .set('x-csrf-token', familyCsrf)
        .send(firstUpdateRequest)
        .expect(404);
    } finally {
      await database.client.familyRelationship.update({
        where: { id: FAMILY_RELATIONSHIP_ID },
        data: { revokedAt: null },
      });
    }
  });

  it('removes family emergency visibility immediately after relationship, consent or sharing withdrawal', async () => {
    const family = request.agent(server);
    await login(family, 'family.demo');
    const assertInvisible = async () => {
      const page = familyEmergencySummariesPageSchema.parse(
        (await family.get('/family/emergencies').expect(200)).body,
      );
      expect(
        page.items.some(
          (item) => item.emergencyEventId === SEEDED_REVIEWED_EVENT_ID,
        ),
      ).toBe(false);
      await family
        .get(
          `/family/elders/${ELDER_ID}/emergency-notification-preference`,
        )
        .expect(404);
    };

    await database.client.familyRelationship.update({
      where: { id: FAMILY_RELATIONSHIP_ID },
      data: { revokedAt: new Date() },
    });
    try {
      await assertInvisible();
    } finally {
      await database.client.familyRelationship.update({
        where: { id: FAMILY_RELATIONSHIP_ID },
        data: { revokedAt: null },
      });
    }

    await database.client.consentRecord.update({
      where: { id: FAMILY_CONSENT_ID },
      data: { decision: 'WITHDRAWN' },
    });
    try {
      await assertInvisible();
    } finally {
      await database.client.consentRecord.update({
        where: { id: FAMILY_CONSENT_ID },
        data: { decision: 'GRANTED' },
      });
    }

    await database.client.sharingPreference.update({
      where: { id: FAMILY_TIMELINE_SHARING_ID },
      data: { allowed: false },
    });
    try {
      await assertInvisible();
    } finally {
      await database.client.sharingPreference.update({
        where: { id: FAMILY_TIMELINE_SHARING_ID },
        data: { allowed: true },
      });
    }
    familyEmergencyNotificationPreferenceSchema.parse(
      (
        await family
          .get(
            `/family/elders/${ELDER_ID}/emergency-notification-preference`,
          )
          .expect(200)
      ).body,
    );
  });

  it('enforces human-only resolution and review in the database as defense in depth', async () => {
    for (const actorType of ['DEVICE', 'SYSTEM', 'AGENT'] as const) {
      for (const toStatus of ['RESOLVED', 'REVIEWED'] as const) {
        await expect(
          database.client.emergencyTransition.create({
            data: {
              organizationId: ORGANIZATION_ID,
              facilityId: FACILITY_ID,
              emergencyEventId: SEEDED_REVIEWED_EVENT_ID,
              fromStatus:
                toStatus === 'RESOLVED' ? 'RESPONDING' : 'RESOLVED',
              toStatus,
              fromVersion: toStatus === 'RESOLVED' ? 100 : 101,
              toVersion: toStatus === 'RESOLVED' ? 101 : 102,
              actorType,
              actorExternalId: `integration-${actorType.toLowerCase()}`,
              reasonCode: 'NON_HUMAN_FINALIZATION_MUST_FAIL',
              correlationId: `m04-human-constraint-${randomUUID()}`,
              occurredAt: new Date(),
            },
          }),
        ).rejects.toThrow(/emergency_transitions_human_finalization/);
      }
    }
    await expect(
      database.client.$executeRawUnsafe(
        `SELECT 'AI'::"EventActorType"`,
      ),
    ).rejects.toThrow(/invalid input value for enum/);
  });
});

async function login(agent: TestAgent, loginName: string): Promise<Response> {
  return agent
    .post('/auth/login')
    .set('Origin', ORIGIN)
    .send({ loginName, password: DEMO_PASSWORD })
    .expect(200);
}

function readCsrfToken(response: Response): string {
  const cookies = response.headers['set-cookie'];
  const values = Array.isArray(cookies)
    ? cookies.filter((value): value is string => typeof value === 'string')
    : typeof cookies === 'string'
      ? [cookies]
      : [];
  const token = values
    .find((value) => value.startsWith('eldercare_csrf='))
    ?.split(';', 1)[0]
    ?.split('=', 2)[1];
  if (token === undefined) throw new Error('CSRF cookie was not set');
  return token;
}

function adminPath(suffix: string): string {
  return `/admin/organizations/${ORGANIZATION_ID}/facilities/${FACILITY_ID}/${suffix}`;
}

function resolutionChecklist() {
  return [
    { code: 'SCENE_SAFETY_CONFIRMED', confirmed: true },
    { code: 'ELDER_STATE_CONFIRMED', confirmed: true },
    { code: 'FOLLOW_UP_HANDOFF_CONFIRMED', confirmed: true },
  ];
}

function errorCode(response: Response): string | undefined {
  const body =
    typeof response.body === 'object' && response.body !== null
      ? (response.body as Record<string, unknown>)
      : {};
  const error =
    typeof body['error'] === 'object' && body['error'] !== null
      ? (body['error'] as Record<string, unknown>)
      : {};
  return typeof error['code'] === 'string' ? error['code'] : undefined;
}

function jsonObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function restoreEnvironment(name: string, previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = previous;
  }
}

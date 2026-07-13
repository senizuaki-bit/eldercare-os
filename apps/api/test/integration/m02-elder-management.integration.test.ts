import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ServiceConfig } from '@eldercare/config';
import type { Prisma } from '@eldercare/db';
import {
  bedsPageSchema,
  caregiverEldersPageSchema,
  elderDetailSchema,
  eldersPageSchema,
  familyElderSummarySchema,
  familyEldersPageSchema,
  familyRelationshipSchema,
  roomsPageSchema,
  shiftsPageSchema,
  staffPageSchema,
} from '@eldercare/contracts';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { DatabaseService } from '../../src/database/database.service.js';
import { configureHttpApplication, createOpenApiDocument } from '../../src/http-application.js';
import { selectAllowedFieldsForCurrentGrant } from '../../src/m02/elders.service.js';
import { SERVICE_CONFIG } from '../../src/tokens.js';

const ORIGIN = 'http://127.0.0.1:3000';
const DEMO_PASSWORD = 'LocalDemoOnly!2026';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
type TestAgent = ReturnType<typeof request.agent>;

const IDS = {
  organization: {
    qinglan: '10000000-0000-4000-8000-000000000002',
    songhe: '10000000-0000-4000-8000-000000000003',
  },
  facility: {
    qinglanMain: '20000000-0000-4000-8000-000000000001',
    qinglanEast: '20000000-0000-4000-8000-000000000002',
    songheMain: '20000000-0000-4000-8000-000000000003',
  },
  elder: {
    familyLinked: '87000000-0000-4000-8000-000000000001',
    overlapProbe: '87000000-0000-4000-8000-000000000012',
    missing: '99999999-0000-4000-8000-000000000001',
  },
  bed: {
    occupied: '85000000-0000-4000-8000-000000000001',
  },
  building: {
    first: '81000000-0000-4000-8000-000000000001',
    second: '81000000-0000-4000-8000-000000000002',
  },
  floor: {
    first: '82000000-0000-4000-8000-000000000001',
  },
  zone: {
    first: '83000000-0000-4000-8000-000000000001',
    third: '83000000-0000-4000-8000-000000000003',
  },
  shift: {
    current: '95000000-0000-4000-8000-000000000001',
  },
  user: {
    secondaryFamily: '30000000-0000-4000-8000-000000000015',
    tertiaryFamily: '30000000-0000-4000-8000-000000000016',
  },
  familyRelationship: {
    primary: '8a000000-0000-4000-8000-000000000001',
  },
  consent: {
    familySharing: '8f000000-0000-4000-8000-000000000001',
  },
  team: {
    first: '93000000-0000-4000-8000-000000000001',
  },
} as const;

describe.sequential('M02 elder and facility operations', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;
  const previousRateLimitPrefix = process.env['AUTH_RATE_LIMIT_KEY_PREFIX'];
  const previousCorsOrigins = process.env['CORS_ORIGINS'];

  beforeAll(async () => {
    process.env['AUTH_RATE_LIMIT_KEY_PREFIX'] = `eldercare:m02-integration:${Date.now()}`;
    process.env['CORS_ORIGINS'] = ORIGIN;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureHttpApplication(app, app.get<ServiceConfig>(SERVICE_CONFIG));
    await app.init();
    server = app.getHttpServer() as Server;
    database = app.get(DatabaseService);
  });

  afterAll(async () => {
    await app?.close();
    restoreEnvironment('AUTH_RATE_LIMIT_KEY_PREFIX', previousRateLimitPrefix);
    restoreEnvironment('CORS_ORIGINS', previousCorsOrigins);
  });

  it('serves strictly contract-valid elder, room, bed, staff and shift pages to an admin', async () => {
    const director = request.agent(server);
    await login(director, 'facility.director');

    const eldersResponse = await director
      .get(adminPath('elders'))
      .query({ page: 1, pageSize: 100, sort: 'displayName', direction: 'asc' })
      .expect(200);
    const elders = eldersPageSchema.parse(eldersResponse.body);
    expect(elders.items).toHaveLength(12);
    expect(elders.items.every((elder) => elder.facilityId === IDS.facility.qinglanMain)).toBe(true);

    const elderResponse = await director
      .get(adminPath(`elders/${elders.items[0]?.id ?? IDS.elder.familyLinked}`))
      .expect(200);
    const elder = elderDetailSchema.parse(elderResponse.body);
    expect(elder.organizationId).toBe(IDS.organization.qinglan);
    expect(elder.facilityId).toBe(IDS.facility.qinglanMain);

    const roomsResponse = await director
      .get(adminPath('directory/rooms'))
      .query({ page: 1, pageSize: 100, occupancy: 'ANY', sort: 'code', direction: 'asc' })
      .expect(200);
    const rooms = roomsPageSchema.parse(roomsResponse.body);
    expect(rooms.items).toHaveLength(8);
    expect(rooms.items.every((room) => room.activeBedCount <= room.bedCount)).toBe(true);
    expect(rooms.items.every((room) => room.occupiedBedCount <= room.activeBedCount)).toBe(true);
    expect(
      rooms.items.every(
        (room) => room.occupiedBedCount + room.availableBedCount === room.activeBedCount,
      ),
    ).toBe(true);

    const fullRoomsResponse = await director
      .get(adminPath('directory/rooms'))
      .query({ page: 1, pageSize: 100, occupancy: 'FULL', sort: 'code', direction: 'asc' })
      .expect(200);
    const fullRooms = roomsPageSchema.parse(fullRoomsResponse.body);
    expect(fullRooms.items.length).toBeGreaterThan(0);
    expect(
      fullRooms.items.every(
        (room) => room.activeBedCount > 0 && room.occupiedBedCount === room.activeBedCount,
      ),
    ).toBe(true);

    const bedsResponse = await director
      .get(adminPath('directory/beds'))
      .query({ page: 1, pageSize: 100, occupancy: 'ANY', sort: 'code', direction: 'asc' })
      .expect(200);
    const beds = bedsPageSchema.parse(bedsResponse.body);
    expect(beds.items).toHaveLength(16);
    expect(beds.items.filter((bed) => bed.occupancy !== null)).toHaveLength(12);

    const staffResponse = await director
      .get(adminPath('staff'))
      .query({ page: 1, pageSize: 100, sort: 'displayName', direction: 'asc' })
      .expect(200);
    const staff = staffPageSchema.parse(staffResponse.body);
    expect(staff.items).toHaveLength(10);

    const now = Date.now();
    const shiftsResponse = await director
      .get(adminPath('shifts'))
      .query({
        page: 1,
        pageSize: 100,
        from: new Date(now - 6 * DAY).toISOString(),
        to: new Date(now + 6 * DAY).toISOString(),
        sort: 'startsAt',
        direction: 'asc',
      })
      .expect(200);
    const shifts = shiftsPageSchema.parse(shiftsResponse.body);
    expect(shifts.items.length).toBeGreaterThan(0);
    expect(shifts.items.some((shift) => shift.code === 'SHIFT-CURRENT')).toBe(true);
  });

  it('ANDs building, floor and zone filters when listing beds', async () => {
    const director = request.agent(server);
    await login(director, 'facility.director');

    const matchingResponse = await director
      .get(adminPath('directory/beds'))
      .query({
        page: 1,
        pageSize: 100,
        buildingId: IDS.building.first,
        floorId: IDS.floor.first,
        zoneId: IDS.zone.first,
        occupancy: 'ANY',
        sort: 'code',
        direction: 'asc',
      })
      .expect(200);
    const matching = bedsPageSchema.parse(matchingResponse.body);
    expect(matching.items.map((bed) => bed.code)).toEqual(['BED-001', 'BED-002']);

    for (const filters of [
      {
        buildingId: IDS.building.first,
        floorId: IDS.floor.first,
        zoneId: IDS.zone.third,
      },
      {
        buildingId: IDS.building.second,
        floorId: IDS.floor.first,
        zoneId: IDS.zone.first,
      },
    ]) {
      const mismatchedResponse = await director
        .get(adminPath('directory/beds'))
        .query({
          page: 1,
          pageSize: 100,
          ...filters,
          occupancy: 'ANY',
          sort: 'code',
          direction: 'asc',
        })
        .expect(200);
      expect(bedsPageSchema.parse(mismatchedResponse.body).items).toHaveLength(0);
    }
  });

  it('paginates relationship, contact and team-membership history with stable ordering', async () => {
    const director = request.agent(server);
    await login(director, 'facility.director');
    const relationshipIds = [randomUUID(), randomUUID()];
    const contactIds = [randomUUID(), randomUUID()];
    const now = Date.now();

    try {
      await database.client.familyRelationship.createMany({
        data: [
          {
            id: relationshipIds[0] ?? randomUUID(),
            organizationId: IDS.organization.qinglan,
            facilityId: IDS.facility.qinglanMain,
            elderId: IDS.elder.familyLinked,
            familyUserId: IDS.user.secondaryFamily,
            relationshipKind: 'CHILD',
            status: 'PENDING',
            activeFrom: new Date(now - 10 * 60_000),
          },
          {
            id: relationshipIds[1] ?? randomUUID(),
            organizationId: IDS.organization.qinglan,
            facilityId: IDS.facility.qinglanMain,
            elderId: IDS.elder.familyLinked,
            familyUserId: IDS.user.tertiaryFamily,
            relationshipKind: 'SIBLING',
            status: 'PENDING',
            activeFrom: new Date(now - 5 * 60_000),
          },
        ],
      });
      await database.client.emergencyContact.createMany({
        data: [
          {
            id: contactIds[0] ?? randomUUID(),
            organizationId: IDS.organization.qinglan,
            facilityId: IDS.facility.qinglanMain,
            elderId: IDS.elder.familyLinked,
            displayName: '分页联系人甲',
            relationshipLabel: '测试关系',
            contactValue: '000-0001',
            priority: 19,
            isPrimary: false,
          },
          {
            id: contactIds[1] ?? randomUUID(),
            organizationId: IDS.organization.qinglan,
            facilityId: IDS.facility.qinglanMain,
            elderId: IDS.elder.familyLinked,
            displayName: '分页联系人乙',
            relationshipLabel: '测试关系',
            contactValue: '000-0002',
            priority: 20,
            isPrimary: false,
          },
        ],
      });

      const relationshipExpected = await database.client.familyRelationship.findMany({
        where: {
          organizationId: IDS.organization.qinglan,
          facilityId: IDS.facility.qinglanMain,
          elderId: IDS.elder.familyLinked,
        },
        select: { id: true },
        orderBy: [{ activeFrom: 'desc' }, { id: 'desc' }],
      });
      await expectStablePages(
        director,
        adminPath(`elders/${IDS.elder.familyLinked}/family-relationships`),
        relationshipExpected.map((item) => item.id),
      );

      const contactExpected = await database.client.emergencyContact.findMany({
        where: {
          organizationId: IDS.organization.qinglan,
          facilityId: IDS.facility.qinglanMain,
          elderId: IDS.elder.familyLinked,
        },
        select: { id: true },
        orderBy: [{ priority: 'asc' }, { id: 'asc' }],
      });
      await expectStablePages(
        director,
        adminPath(`elders/${IDS.elder.familyLinked}/emergency-contacts`),
        contactExpected.map((item) => item.id),
      );

      const membershipExpected = await database.client.teamMembership.findMany({
        where: {
          organizationId: IDS.organization.qinglan,
          facilityId: IDS.facility.qinglanMain,
          teamId: IDS.team.first,
        },
        select: { id: true },
        orderBy: [{ activeFrom: 'desc' }, { id: 'desc' }],
      });
      expect(membershipExpected.length).toBeGreaterThan(1);
      await expectStablePages(
        director,
        adminPath(`teams/${IDS.team.first}/memberships`),
        membershipExpected.map((item) => item.id),
      );
    } finally {
      await database.client.$transaction([
        database.client.emergencyContact.deleteMany({ where: { id: { in: contactIds } } }),
        database.client.familyRelationship.deleteMany({ where: { id: { in: relationshipIds } } }),
      ]);
    }
  });

  it('projects only consented fields for a verified family relationship', async () => {
    const family = request.agent(server);
    await login(family, 'family.demo');

    const pageResponse = await family.get('/family/elders').expect(200);
    const page = familyEldersPageSchema.parse(pageResponse.body);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe(IDS.elder.familyLinked);
    expect(page.items[0]?.sharedFields).toEqual(
      expect.arrayContaining(['PREFERRED_NAME', 'CURRENT_RESIDENCE']),
    );

    const detailResponse = await family
      .get(`/family/elders/${IDS.elder.familyLinked}`)
      .expect(200);
    const detail = familyElderSummarySchema.parse(detailResponse.body);
    expect(detail.id).toBe(IDS.elder.familyLinked);
    expect(JSON.stringify(detail)).not.toMatch(
      /birthDate|emergencyContact|caregiverLiveLocation|internalNote|rawAudio|transcript|coordinate/i,
    );
  });

  it('treats sharing preferences as a full replacement and lets an empty list revoke all fields', async () => {
    const director = request.agent(server);
    const loggedIn = await login(director, 'facility.director');
    const csrfToken = readCsrfToken(loggedIn);
    const correlationId = `m02-sharing-replace-${Date.now()}`;
    const relationship = await database.client.familyRelationship.findUniqueOrThrow({
      where: { id: IDS.familyRelationship.primary },
      select: { version: true, updatedAt: true },
    });
    const preferenceSnapshot = await database.client.sharingPreference.findMany({
      where: { familyRelationshipId: IDS.familyRelationship.primary },
      orderBy: [{ field: 'asc' }, { version: 'asc' }],
    });
    const replaceStartedAt = new Date();

    try {
      const replacedResponse = await director
        .put(
          adminPath(
            `elders/${IDS.elder.familyLinked}/family-relationships/${IDS.familyRelationship.primary}/sharing-preferences`,
          ),
        )
        .set('Origin', ORIGIN)
        .set('x-csrf-token', csrfToken)
        .set('x-correlation-id', correlationId)
        .send({
          expectedVersion: relationship.version,
          preferences: [
            {
              field: 'PREFERRED_NAME',
              allowed: true,
            },
          ],
        })
        .expect(200);
      const replaced = familyRelationshipSchema.parse(replacedResponse.body);
      expect(replaced.sharingPreferences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'PREFERRED_NAME', allowed: true }),
          expect.objectContaining({ field: 'CURRENT_RESIDENCE', allowed: false }),
        ]),
      );
      const closedResidence = await database.client.sharingPreference.findFirstOrThrow({
        where: {
          familyRelationshipId: IDS.familyRelationship.primary,
          field: 'CURRENT_RESIDENCE',
          version: 1,
        },
        select: { validUntil: true },
      });
      expect(closedResidence.validUntil?.getTime()).toBeGreaterThanOrEqual(
        replaceStartedAt.getTime(),
      );
      expect(closedResidence.validUntil?.getTime()).toBeLessThanOrEqual(Date.now());

      const revokedResponse = await director
        .put(
          adminPath(
            `elders/${IDS.elder.familyLinked}/family-relationships/${IDS.familyRelationship.primary}/sharing-preferences`,
          ),
        )
        .set('Origin', ORIGIN)
        .set('x-csrf-token', csrfToken)
        .set('x-correlation-id', correlationId)
        .send({ expectedVersion: replaced.version, preferences: [] })
        .expect(200);
      const revoked = familyRelationshipSchema.parse(revokedResponse.body);
      expect(revoked.sharingPreferences.length).toBeGreaterThan(0);
      expect(revoked.sharingPreferences.every((preference) => !preference.allowed)).toBe(true);
    } finally {
      await database.client.$transaction(async (transaction) => {
        await transaction.elderTimelineEntry.deleteMany({ where: { correlationId } });
        await transaction.outboxEvent.deleteMany({ where: { correlationId } });
        await transaction.sharingPreference.deleteMany({
          where: { familyRelationshipId: IDS.familyRelationship.primary },
        });
        await transaction.sharingPreference.createMany({ data: preferenceSnapshot });
        await transaction.familyRelationship.update({
          where: { id: IDS.familyRelationship.primary },
          data: { version: relationship.version, updatedAt: relationship.updatedAt },
        });
      });
    }
  });

  it('rejects future sharing preference activation without changing current state', async () => {
    const director = request.agent(server);
    const loggedIn = await login(director, 'facility.director');
    const correlationId = `m02-sharing-future-input-${Date.now()}`;
    const relationship = await database.client.familyRelationship.findUniqueOrThrow({
      where: { id: IDS.familyRelationship.primary },
      select: { version: true, updatedAt: true },
    });
    const preferenceSnapshot = await database.client.sharingPreference.findMany({
      where: { familyRelationshipId: IDS.familyRelationship.primary },
      orderBy: [{ field: 'asc' }, { version: 'asc' }],
    });

    try {
      await director
        .put(
          adminPath(
            `elders/${IDS.elder.familyLinked}/family-relationships/${IDS.familyRelationship.primary}/sharing-preferences`,
          ),
        )
        .set('Origin', ORIGIN)
        .set('x-csrf-token', readCsrfToken(loggedIn))
        .set('x-correlation-id', correlationId)
        .send({
          expectedVersion: relationship.version,
          preferences: [
            {
              field: 'CARE_LEVEL',
              allowed: true,
              validFrom: new Date(Date.now() + DAY).toISOString(),
            },
          ],
        })
        .expect(400)
        .expect(({ body }: Response) => {
          expect(body).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
        });
      const unchanged = await database.client.familyRelationship.findUniqueOrThrow({
        where: { id: IDS.familyRelationship.primary },
        select: { version: true },
      });
      expect(unchanged.version).toBe(relationship.version);
    } finally {
      await restoreSharingFixture(database, correlationId, relationship, preferenceSnapshot);
    }
  });

  it('suppresses a pre-existing future allow when an empty replacement is applied today', async () => {
    const director = request.agent(server);
    const loggedIn = await login(director, 'facility.director');
    const correlationId = `m02-sharing-future-existing-${Date.now()}`;
    const relationship = await database.client.familyRelationship.findUniqueOrThrow({
      where: { id: IDS.familyRelationship.primary },
      select: { version: true, updatedAt: true },
    });
    const preferenceSnapshot = await database.client.sharingPreference.findMany({
      where: { familyRelationshipId: IDS.familyRelationship.primary },
      orderBy: [{ field: 'asc' }, { version: 'asc' }],
    });
    const futureAt = new Date(Date.now() + DAY);
    const futurePreferenceId = randomUUID();

    try {
      await database.client.sharingPreference.create({
        data: {
          id: futurePreferenceId,
          organizationId: IDS.organization.qinglan,
          facilityId: IDS.facility.qinglanMain,
          elderId: IDS.elder.familyLinked,
          familyRelationshipId: IDS.familyRelationship.primary,
          consentRecordId: IDS.consent.familySharing,
          field: 'CARE_LEVEL',
          allowed: true,
          validFrom: futureAt,
          version: 1,
        },
      });

      await director
        .put(
          adminPath(
            `elders/${IDS.elder.familyLinked}/family-relationships/${IDS.familyRelationship.primary}/sharing-preferences`,
          ),
        )
        .set('Origin', ORIGIN)
        .set('x-csrf-token', readCsrfToken(loggedIn))
        .set('x-correlation-id', correlationId)
        .send({ expectedVersion: relationship.version, preferences: [] })
        .expect(200);

      const preferences = await database.client.sharingPreference.findMany({
        where: { familyRelationshipId: IDS.familyRelationship.primary },
        select: {
          field: true,
          allowed: true,
          consentRecordId: true,
          validFrom: true,
          validUntil: true,
          version: true,
        },
        orderBy: [{ field: 'asc' }, { version: 'desc' }],
      });
      const futureProjectionAt = new Date(futureAt.getTime() + HOUR);
      expect(
        selectAllowedFieldsForCurrentGrant(
          preferences,
          IDS.consent.familySharing,
          futureProjectionAt,
        ),
      ).not.toContain('CARE_LEVEL');
      expect(
        preferences.some(
          (preference) =>
            preference.field === 'CARE_LEVEL' &&
            preference.allowed &&
            preference.validFrom <= futureProjectionAt &&
            (preference.validUntil === null || preference.validUntil > futureProjectionAt),
        ),
      ).toBe(false);
    } finally {
      await restoreSharingFixture(database, correlationId, relationship, preferenceSnapshot);
    }
  });

  it('rejects allowed family sharing when no active FAMILY_SHARING consent exists', async () => {
    const director = request.agent(server);
    const loggedIn = await login(director, 'facility.director');
    const relationship = await database.client.familyRelationship.findUniqueOrThrow({
      where: { id: IDS.familyRelationship.primary },
      select: { version: true },
    });
    const consent = await database.client.consentRecord.findUniqueOrThrow({
      where: { id: IDS.consent.familySharing },
      select: { supersededAt: true },
    });

    try {
      await database.client.consentRecord.update({
        where: { id: IDS.consent.familySharing },
        data: { supersededAt: new Date() },
      });
      await director
        .put(
          adminPath(
            `elders/${IDS.elder.familyLinked}/family-relationships/${IDS.familyRelationship.primary}/sharing-preferences`,
          ),
        )
        .set('Origin', ORIGIN)
        .set('x-csrf-token', readCsrfToken(loggedIn))
        .send({
          expectedVersion: relationship.version,
          preferences: [
            {
              field: 'PREFERRED_NAME',
              allowed: true,
            },
          ],
        })
        .expect(409)
        .expect(({ body }: Response) => {
          expect(body).toMatchObject({
            error: { code: 'FAMILY_SHARING_CONSENT_REQUIRED' },
          });
        });
      const unchanged = await database.client.familyRelationship.findUniqueOrThrow({
        where: { id: IDS.familyRelationship.primary },
        select: { version: true },
      });
      expect(unchanged.version).toBe(relationship.version);
    } finally {
      await database.client.consentRecord.update({
        where: { id: IDS.consent.familySharing },
        data: { supersededAt: consent.supersededAt },
      });
    }
  });

  it('grants caregiver projection only for a live accepted shift assignment', async () => {
    const activeCaregiver = request.agent(server);
    await login(activeCaregiver, 'caregiver.demo');
    const activeResponse = await activeCaregiver.get('/caregiver/elders').expect(200);
    const active = caregiverEldersPageSchema.parse(activeResponse.body);
    expect(active.items.some((elder) => elder.id === IDS.elder.familyLinked)).toBe(true);
    expect(JSON.stringify(active)).not.toMatch(
      /birthDate|emergencyContact|familyRelationship|consentRecord|rawAudio|transcript/i,
    );

    const shift = await database.client.shift.findUniqueOrThrow({
      where: { id: IDS.shift.current },
      select: { status: true, startsAt: true, endsAt: true, version: true, updatedAt: true },
    });
    const assignment = await database.client.shiftAssignment.findFirstOrThrow({
      where: { shiftId: IDS.shift.current },
      select: { id: true, status: true, version: true, updatedAt: true },
    });

    try {
      await database.client.shift.update({
        where: { id: IDS.shift.current },
        data: { status: 'COMPLETED', endsAt: new Date(Date.now() - 1000) },
      });
      const expiredResponse = await activeCaregiver.get('/caregiver/elders').expect(200);
      expect(caregiverEldersPageSchema.parse(expiredResponse.body).items).toHaveLength(0);

      await database.client.shift.update({
        where: { id: IDS.shift.current },
        data: {
          status: shift.status,
          startsAt: shift.startsAt,
          endsAt: shift.endsAt,
          version: shift.version,
          updatedAt: shift.updatedAt,
        },
      });
      await database.client.shiftAssignment.update({
        where: { id: assignment.id },
        data: { status: 'CANCELLED' },
      });
      const cancelledResponse = await activeCaregiver.get('/caregiver/elders').expect(200);
      expect(caregiverEldersPageSchema.parse(cancelledResponse.body).items).toHaveLength(0);
    } finally {
      await database.client.$transaction([
        database.client.shift.update({
          where: { id: IDS.shift.current },
          data: {
            status: shift.status,
            startsAt: shift.startsAt,
            endsAt: shift.endsAt,
            version: shift.version,
            updatedAt: shift.updatedAt,
          },
        }),
        database.client.shiftAssignment.update({
          where: { id: assignment.id },
          data: {
            status: assignment.status,
            version: assignment.version,
            updatedAt: assignment.updatedAt,
          },
        }),
      ]);
    }
  });

  it('does not let family, caregiver or elder sessions bypass projections through admin routes', async () => {
    const protectedPaths = [
      adminPath('elders'),
      adminPath('directory/rooms'),
      adminPath('staff'),
      adminPath('shifts'),
    ];

    for (const loginName of ['family.demo', 'caregiver.demo', 'elder.demo']) {
      const nonAdmin = request.agent(server);
      await login(nonAdmin, loginName);
      for (const path of protectedPaths) {
        const response = await nonAdmin.get(path).expect(404);
        expect(response.body).toMatchObject({ error: { code: 'RESOURCE_NOT_FOUND' } });
        expect(JSON.stringify(response.body)).not.toMatch(/elder|room|staff|shift|permission|portal/i);
      }
    }
  });

  it('does not widen a floor-scoped admin principal to facility-wide M02 access', async () => {
    const assignment = await database.client.userRole.findFirstOrThrow({
      where: {
        user: { loginName: 'facility.director' },
        role: { code: 'FACILITY_DIRECTOR' },
        organizationId: IDS.organization.qinglan,
      },
      include: {
        dataScopes: {
          where: { kind: 'FACILITY', facilityId: IDS.facility.qinglanMain },
          take: 1,
        },
      },
    });
    const broadScope = assignment.dataScopes[0];
    if (broadScope === undefined) throw new Error('director facility scope is unavailable');

    try {
      await database.client.dataScope.update({
        where: { id: broadScope.id },
        data: {
          kind: 'FLOOR',
          scopeKey: `floor:${IDS.floor.first}`,
          resourceType: 'FLOOR',
          resourceId: IDS.floor.first,
        },
      });
      const floorScopedAdmin = request.agent(server);
      await login(floorScopedAdmin, 'facility.director');
      for (const path of [
        adminPath('elders'),
        adminPath('directory/rooms'),
        adminPath('staff'),
        adminPath('shifts'),
      ]) {
        await floorScopedAdmin.get(path).expect(404);
      }
    } finally {
      await database.client.dataScope.update({
        where: { id: broadScope.id },
        data: {
          kind: broadScope.kind,
          scopeKey: broadScope.scopeKey,
          facilityId: broadScope.facilityId,
          resourceType: broadScope.resourceType,
          resourceId: broadScope.resourceId,
          validFrom: broadScope.validFrom,
          validUntil: broadScope.validUntil,
        },
      });
    }
  });

  it('makes cross-facility, cross-organization and missing elder reads indistinguishable', async () => {
    const director = request.agent(server);
    await login(director, 'facility.director');
    const crossFacility = await director
      .get(adminPathFor(IDS.organization.qinglan, IDS.facility.qinglanEast, 'elders'))
      .expect(404);
    const crossOrganization = await director
      .get(adminPathFor(IDS.organization.songhe, IDS.facility.songheMain, 'elders'))
      .expect(404);
    const missing = await director
      .get(adminPath(`elders/${IDS.elder.missing}`))
      .expect(404);

    expect(errorSignature(crossFacility)).toEqual(errorSignature(crossOrganization));
    expect(errorSignature(crossFacility)).toEqual(errorSignature(missing));
  });

  it('rejects a stale optimistic version without changing the directory record', async () => {
    const director = request.agent(server);
    const loggedIn = await login(director, 'facility.director');
    const original = await database.client.building.findUniqueOrThrow({
      where: { id: IDS.building.first },
      select: { name: true, version: true, updatedAt: true },
    });

    await director
      .put(adminPath(`directory/buildings/${IDS.building.first}`))
      .set('Origin', ORIGIN)
      .set('x-csrf-token', readCsrfToken(loggedIn))
      .send({ expectedVersion: original.version + 1, name: `${original.name} stale` })
      .expect(409)
      .expect(({ body }: Response) => {
        expect(body).toMatchObject({ error: { code: 'VERSION_CONFLICT' } });
      });

    const unchanged = await database.client.building.findUniqueOrThrow({
      where: { id: IDS.building.first },
      select: { name: true, version: true, updatedAt: true },
    });
    expect(unchanged).toEqual(original);
  });

  it('rejects a bed overlap and restores the temporary seed state', async () => {
    const director = request.agent(server);
    const loggedIn = await login(director, 'facility.director');
    const elder = await database.client.elder.findUniqueOrThrow({
      where: { id: IDS.elder.overlapProbe },
      select: { status: true, version: true, updatedAt: true },
    });
    const stay = await database.client.elderStay.findFirstOrThrow({
      where: { elderId: IDS.elder.overlapProbe, status: 'ACTIVE' },
      select: {
        id: true,
        status: true,
        admittedAt: true,
        dischargedAt: true,
        dischargeReasonCode: true,
        version: true,
        updatedAt: true,
      },
    });
    const dischargedAt = new Date(Math.max(stay.admittedAt.getTime() + HOUR, Date.now() - HOUR));

    try {
      await database.client.$transaction([
        database.client.elderStay.update({
          where: { id: stay.id },
          data: {
            status: 'DISCHARGED',
            dischargedAt,
            dischargeReasonCode: 'INTEGRATION_PROBE',
          },
        }),
        database.client.elder.update({
          where: { id: IDS.elder.overlapProbe },
          data: { status: 'DISCHARGED' },
        }),
      ]);

      const response = await director
        .post(adminPath(`elders/${IDS.elder.overlapProbe}/stays`))
        .set('Origin', ORIGIN)
        .set('x-csrf-token', readCsrfToken(loggedIn))
        .send({
          expectedElderVersion: elder.version,
          bedId: IDS.bed.occupied,
          admittedAt: new Date(dischargedAt.getTime() + 1000).toISOString(),
          admissionReasonCode: 'INTEGRATION_PROBE',
        })
        .expect(409);
      expect(response.body).toMatchObject({ error: { code: 'BED_STAY_OVERLAP' } });
    } finally {
      await database.client.$transaction([
        database.client.elderStay.update({
          where: { id: stay.id },
          data: {
            status: stay.status,
            dischargedAt: stay.dischargedAt,
            dischargeReasonCode: stay.dischargeReasonCode,
            version: stay.version,
            updatedAt: stay.updatedAt,
          },
        }),
        database.client.elder.update({
          where: { id: IDS.elder.overlapProbe },
          data: {
            status: elder.status,
            version: elder.version,
            updatedAt: elder.updatedAt,
          },
        }),
      ]);
    }
  });

  it('records a relationship decision reason and unique outbox identities atomically', async () => {
    const director = request.agent(server);
    const loggedIn = await login(director, 'facility.director');
    const csrfToken = readCsrfToken(loggedIn);
    const correlationId = `m02-relationship-${Date.now()}`;
    let relationshipId: string | undefined;

    try {
      const createdResponse = await director
        .post(adminPath(`elders/${IDS.elder.familyLinked}/family-relationships`))
        .set('Origin', ORIGIN)
        .set('x-csrf-token', csrfToken)
        .set('x-correlation-id', correlationId)
        .send({
          familyUserId: IDS.user.secondaryFamily,
          relationshipKind: 'CHILD',
          relationshipLabel: '集成测试临时关系',
          activeFrom: new Date(Date.now() - 60_000).toISOString(),
        })
        .expect(201);
      const rawRelationshipId = (createdResponse.body as { id?: unknown }).id;
      if (typeof rawRelationshipId === 'string') relationshipId = rawRelationshipId;
      const created = familyRelationshipSchema.parse(createdResponse.body);
      relationshipId = created.id;

      const revokedResponse = await director
        .post(
          adminPath(
            `elders/${IDS.elder.familyLinked}/family-relationships/${created.id}/revoke`,
          ),
        )
        .set('Origin', ORIGIN)
        .set('x-csrf-token', csrfToken)
        .set('x-correlation-id', correlationId)
        .send({ expectedVersion: created.version, reasonCode: 'INTEGRATION_REVOKE' })
        .expect(201);
      const revoked = familyRelationshipSchema.parse(revokedResponse.body);
      expect(revoked.status).toBe('REVOKED');

      const [audit, outbox] = await Promise.all([
        database.client.auditEvent.findFirstOrThrow({
          where: { correlationId, action: 'ELDER.FAMILY_RELATIONSHIP_REVOKED' },
          select: { reasonCode: true, resourceId: true },
        }),
        database.client.outboxEvent.findMany({
          where: { correlationId },
          select: { eventId: true, eventType: true, idempotencyKey: true },
          orderBy: { occurredAt: 'asc' },
        }),
      ]);
      expect(audit).toEqual({ reasonCode: 'INTEGRATION_REVOKE', resourceId: created.id });
      expect(outbox).toHaveLength(2);
      expect(outbox.map((event) => event.eventType)).toEqual([
        'ELDER.FAMILY_RELATIONSHIP_CREATED.V1',
        'ELDER.FAMILY_RELATIONSHIP_REVOKED.V1',
      ]);
      expect(outbox.every((event) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(event.eventId))).toBe(true);
      expect(new Set(outbox.map((event) => event.idempotencyKey)).size).toBe(outbox.length);
    } finally {
      await database.client.$transaction(async (transaction) => {
        await transaction.elderTimelineEntry.deleteMany({ where: { correlationId } });
        await transaction.outboxEvent.deleteMany({ where: { correlationId } });
        // Audit events are append-only by database policy and intentionally remain as evidence.
        if (relationshipId !== undefined) {
          await transaction.sharingPreference.deleteMany({
            where: { familyRelationshipId: relationshipId },
          });
          await transaction.familyRelationship.delete({ where: { id: relationshipId } });
        }
      });
    }
  });

  it('publishes the M02 operational and projection paths in OpenAPI', () => {
    const document = createOpenApiDocument(app, app.get<ServiceConfig>(SERVICE_CONFIG));
    const expectedOperations = [
      ['/admin/organizations/{organizationId}/facilities/{facilityId}/elders', 'get'],
      ['/admin/organizations/{organizationId}/facilities/{facilityId}/elders/{elderId}', 'get'],
      ['/admin/organizations/{organizationId}/facilities/{facilityId}/elders/{elderId}/stays', 'post'],
      ['/admin/organizations/{organizationId}/facilities/{facilityId}/elders/{elderId}/family-relationships/{relationshipId}/sharing-preferences', 'put'],
      ['/admin/organizations/{organizationId}/facilities/{facilityId}/directory/rooms', 'get'],
      ['/admin/organizations/{organizationId}/facilities/{facilityId}/directory/beds', 'get'],
      ['/admin/organizations/{organizationId}/facilities/{facilityId}/staff', 'get'],
      ['/admin/organizations/{organizationId}/facilities/{facilityId}/shifts', 'get'],
      ['/family/elders', 'get'],
      ['/family/elders/{elderId}', 'get'],
      ['/caregiver/elders', 'get'],
    ] as const;

    for (const [path, method] of expectedOperations) {
      expect(document.paths[path]?.[method]).toBeDefined();
    }
    const roomSchema = document.components?.schemas?.['RoomDto'] as
      | { properties?: Record<string, { description?: string }>; required?: string[] }
      | undefined;
    expect(roomSchema?.required).toEqual(
      expect.arrayContaining([
        'bedCount',
        'activeBedCount',
        'occupiedBedCount',
        'availableBedCount',
      ]),
    );
    expect(roomSchema?.properties?.['bedCount']?.description).toContain('physical beds');
    expect(roomSchema?.properties?.['activeBedCount']?.description).toContain('ACTIVE');
    expect(roomSchema?.properties?.['occupiedBedCount']?.description).toContain('active elder stay');
    expect(roomSchema?.properties?.['availableBedCount']?.description).toContain('without an active elder stay');
    const elderCreate = document.paths[
      '/admin/organizations/{organizationId}/facilities/{facilityId}/elders'
    ]?.post;
    const elderCreateBody = elderCreate?.requestBody as
      | { content?: { 'application/json'?: { schema?: { properties?: Record<string, unknown>; required?: string[] } } } }
      | undefined;
    const elderCreateSchema = elderCreateBody?.content?.['application/json']?.schema;
    expect(elderCreateSchema?.required).toEqual(expect.arrayContaining(['recordNumber', 'displayName']));
    expect(elderCreateSchema?.properties).not.toHaveProperty('expectedVersion');
    expect(elderCreate?.responses).toHaveProperty('201');

    const buildingCreate = document.paths[
      '/admin/organizations/{organizationId}/facilities/{facilityId}/directory/buildings'
    ]?.post;
    const buildingCreateBody = buildingCreate?.requestBody as
      | { content?: { 'application/json'?: { schema?: { properties?: Record<string, unknown>; required?: string[] } } } }
      | undefined;
    expect(buildingCreateBody?.content?.['application/json']?.schema?.required).toEqual(
      expect.arrayContaining(['code', 'name']),
    );

    const sharingReplace = document.paths[
      '/admin/organizations/{organizationId}/facilities/{facilityId}/elders/{elderId}/family-relationships/{relationshipId}/sharing-preferences'
    ]?.put;
    const sharingReplaceBody = sharingReplace?.requestBody as
      | {
          content?: {
            'application/json'?: {
              schema?: {
                properties?: {
                  preferences?: { items?: { properties?: Record<string, unknown> } };
                };
              };
            };
          };
        }
      | undefined;
    const preferenceInputProperties = sharingReplaceBody
      ?.content?.['application/json']?.schema?.properties?.preferences?.items?.properties;
    expect(preferenceInputProperties).toHaveProperty('field');
    expect(preferenceInputProperties).toHaveProperty('allowed');
    expect(preferenceInputProperties).toHaveProperty('validUntil');
    expect(preferenceInputProperties).not.toHaveProperty('validFrom');

    const familySchema = document.components?.schemas?.['FamilyElderSummaryDto'] as
      | { properties?: Record<string, unknown> }
      | undefined;
    expect(familySchema?.properties).toHaveProperty('sharedFields');
    expect(familySchema?.properties).not.toHaveProperty('organizationId');
    expect(familySchema?.properties).not.toHaveProperty('recordNumber');
    expect(familySchema?.properties).not.toHaveProperty('portalUserId');
    expect(document.components?.securitySchemes).toHaveProperty('sessionCookie');
    expect(document.components?.securitySchemes).toHaveProperty('csrf');
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
  return adminPathFor(IDS.organization.qinglan, IDS.facility.qinglanMain, suffix);
}

function adminPathFor(organizationId: string, facilityId: string, suffix: string): string {
  return `/admin/organizations/${organizationId}/facilities/${facilityId}/${suffix}`;
}

function errorSignature(response: Response): unknown {
  const body = response.body as { error?: { code?: string; message?: string } };
  return { status: response.status, code: body.error?.code, message: body.error?.message };
}

async function expectStablePages(
  agent: TestAgent,
  path: string,
  expectedIds: readonly string[],
): Promise<void> {
  const firstResponse = await agent.get(path).query({ page: 1, pageSize: 1 }).expect(200);
  const repeatedFirstResponse = await agent.get(path).query({ page: 1, pageSize: 1 }).expect(200);
  const secondResponse = await agent.get(path).query({ page: 2, pageSize: 1 }).expect(200);
  const first = readRelatedPage(firstResponse);
  const repeatedFirst = readRelatedPage(repeatedFirstResponse);
  const second = readRelatedPage(secondResponse);

  expect(first.items.map((item) => item.id)).toEqual(expectedIds.slice(0, 1));
  expect(repeatedFirst.items).toEqual(first.items);
  expect(second.items.map((item) => item.id)).toEqual(expectedIds.slice(1, 2));
  expect(first.pageInfo).toMatchObject({
    page: 1,
    pageSize: 1,
    total: expectedIds.length,
    totalPages: Math.ceil(expectedIds.length),
  });
  expect(second.pageInfo).toMatchObject({ page: 2, pageSize: 1 });

  await agent
    .get(path)
    .query({ page: 1, pageSize: 101 })
    .expect(400)
    .expect(({ body }: Response) => {
      expect(body).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
    });
}

function readRelatedPage(response: Response): {
  items: { id: string }[];
  pageInfo: { page: number; pageSize: number; total: number; totalPages: number };
} {
  return response.body as {
    items: { id: string }[];
    pageInfo: { page: number; pageSize: number; total: number; totalPages: number };
  };
}

async function restoreSharingFixture(
  database: DatabaseService,
  correlationId: string,
  relationship: { version: number; updatedAt: Date },
  preferences: readonly Prisma.SharingPreferenceGetPayload<Record<string, never>>[],
): Promise<void> {
  await database.client.$transaction(async (transaction) => {
    await transaction.elderTimelineEntry.deleteMany({ where: { correlationId } });
    await transaction.outboxEvent.deleteMany({ where: { correlationId } });
    await transaction.sharingPreference.deleteMany({
      where: { familyRelationshipId: IDS.familyRelationship.primary },
    });
    if (preferences.length > 0) {
      await transaction.sharingPreference.createMany({ data: [...preferences] });
    }
    await transaction.familyRelationship.update({
      where: { id: IDS.familyRelationship.primary },
      data: { version: relationship.version, updatedAt: relationship.updatedAt },
    });
  });
}

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

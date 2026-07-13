import 'reflect-metadata';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { SessionContext, UserSummary, UsersPage } from '@eldercare/contracts';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { DatabaseService } from '../../src/database/database.service.js';
import { configureHttpApplication, createOpenApiDocument } from '../../src/http-application.js';
import { SERVICE_CONFIG } from '../../src/tokens.js';
import type { ServiceConfig } from '@eldercare/config';

const ORIGIN = 'http://127.0.0.1:3000';
const DEMO_PASSWORD = 'LocalDemoOnly!2026';
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
  supervisorUser: '30000000-0000-4000-8000-000000000003',
} as const;

describe.sequential('M01 authentication and tenant authorization', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;
  const previousRateLimitPrefix = process.env['AUTH_RATE_LIMIT_KEY_PREFIX'];
  const previousCorsOrigins = process.env['CORS_ORIGINS'];

  beforeAll(async () => {
    process.env['AUTH_RATE_LIMIT_KEY_PREFIX'] = `eldercare:test:${Date.now()}`;
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
    if (previousRateLimitPrefix === undefined) delete process.env['AUTH_RATE_LIMIT_KEY_PREFIX'];
    else process.env['AUTH_RATE_LIMIT_KEY_PREFIX'] = previousRateLimitPrefix;
    if (previousCorsOrigins === undefined) delete process.env['CORS_ORIGINS'];
    else process.env['CORS_ORIGINS'] = previousCorsOrigins;
  });

  it('authenticates every fictional seed role through an opaque cookie session', async () => {
    const accounts = [
      ['platform.admin', 'admin'],
      ['facility.director', 'admin'],
      ['nursing.supervisor', 'admin'],
      ['caregiver.demo', 'caregiver'],
      ['device.manager', 'admin'],
      ['elder.demo', 'elder'],
      ['family.demo', 'family'],
    ] as const;

    for (const [loginName, portal] of accounts) {
      const response = await request(server)
        .post('/auth/login')
        .set('Origin', ORIGIN)
        .send({ loginName, password: DEMO_PASSWORD })
        .expect(200);
      expect((response.body as SessionContext).portal).toBe(portal);
      expect(response.headers['set-cookie']).toEqual(
        expect.arrayContaining([
          expect.stringContaining('eldercare_session='),
          expect.stringContaining('eldercare_csrf='),
        ]),
      );
      expect(String(response.headers['set-cookie'])).not.toContain(DEMO_PASSWORD);
    }
  });

  it('publishes authentication, identity, access and audit operations in OpenAPI', () => {
    const document = createOpenApiDocument(app, app.get<ServiceConfig>(SERVICE_CONFIG));
    expect(document.paths['/auth/login']?.post).toBeDefined();
    expect(document.paths['/auth/session']?.get).toBeDefined();
    expect(document.paths['/admin/organizations/{organizationId}/facilities/{facilityId}/users']?.get).toBeDefined();
    expect(document.paths['/admin/organizations/{organizationId}/facilities/{facilityId}/users/{userId}/access']?.put).toBeDefined();
    expect(document.paths['/admin/organizations/{organizationId}/facilities/{facilityId}/roles']?.get).toBeDefined();
    expect(document.paths['/admin/organizations/{organizationId}/facilities/{facilityId}/audit-events']?.get).toBeDefined();
    expect(document.components?.securitySchemes).toHaveProperty('sessionCookie');
    expect(document.components?.securitySchemes).toHaveProperty('csrf');
  });

  it('returns an indistinguishable credential failure for unknown and known accounts', async () => {
    const unknown = await request(server)
      .post('/auth/login')
      .set('Origin', ORIGIN)
      .send({ loginName: 'missing.demo', password: 'wrong-password' })
      .expect(401);
    const known = await request(server)
      .post('/auth/login')
      .set('Origin', ORIGIN)
      .send({ loginName: 'facility.director', password: 'wrong-password' })
      .expect(401);

    expect(errorSignature(unknown)).toEqual(errorSignature(known));
    expect(JSON.stringify(known.body)).not.toMatch(/password|hash|stack|loginName/i);
  });

  it('lists only the active facility and makes cross-tenant targets indistinguishable', async () => {
    const director = request.agent(server);
    await login(director, 'facility.director');
    const visible = await director
      .get(facilityPath(IDS.organization.qinglan, IDS.facility.qinglanMain, 'users'))
      .expect(200);
    const page = visible.body as UsersPage;
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((user) =>
      user.assignments.every((assignment) => assignment.organizationId === IDS.organization.qinglan),
    )).toBe(true);
    expect(JSON.stringify(page)).not.toContain(IDS.facility.qinglanEast);

    const crossFacility = await director
      .get(facilityPath(IDS.organization.qinglan, IDS.facility.qinglanEast, 'users'))
      .expect(404);
    const crossOrganization = await director
      .get(facilityPath(IDS.organization.songhe, IDS.facility.songheMain, 'users'))
      .expect(404);
    const missing = await director
      .get(facilityPath(
        IDS.organization.qinglan,
        IDS.facility.qinglanMain,
        'users/99999999-0000-4000-8000-000000000001',
      ))
      .expect(404);
    expect(errorSignature(crossFacility)).toEqual(errorSignature(crossOrganization));
    expect(errorSignature(crossFacility)).toEqual(errorSignature(missing));

    const audit = await director
      .get(facilityPath(IDS.organization.qinglan, IDS.facility.qinglanMain, 'audit-events'))
      .query({ pageSize: 100 })
      .expect(200);
    expect(JSON.stringify(audit.body)).toContain('SECURITY.TENANT_CONTEXT_DENIED');
    expect(JSON.stringify(audit.body)).not.toMatch(/password|token|secret|transcript|coordinate/i);
  });

  it('enforces permissions in the API even when a protected URL is known', async () => {
    const caregiver = request.agent(server);
    await login(caregiver, 'caregiver.demo');
    await caregiver
      .get(facilityPath(IDS.organization.qinglan, IDS.facility.qinglanMain, 'users'))
      .expect(403)
      .expect(({ body }: Response) => {
        expect(body).toMatchObject({ error: { code: 'FORBIDDEN' } });
        expect(JSON.stringify(body)).not.toContain('facility.director');
      });
  });

  it('switches an authorized context atomically and scopes subsequent reads to it', async () => {
    const platformAdmin = request.agent(server);
    const loggedIn = await login(platformAdmin, 'platform.admin');
    const switched = await platformAdmin
      .post('/auth/context')
      .set('Origin', ORIGIN)
      .set('x-csrf-token', readCsrfToken(loggedIn))
      .send({
        organizationId: IDS.organization.songhe,
        facilityId: IDS.facility.songheMain,
      })
      .expect(200);

    expect((switched.body as SessionContext).activeContext).toMatchObject({
      organizationId: IDS.organization.songhe,
      facilityId: IDS.facility.songheMain,
    });
    const audit = await platformAdmin
      .get(facilityPath(IDS.organization.songhe, IDS.facility.songheMain, 'audit-events'))
      .query({ pageSize: 100 })
      .expect(200);
    expect(JSON.stringify(audit.body)).toContain('AUTH.CONTEXT_SWITCHED');

    await platformAdmin
      .get(facilityPath(IDS.organization.qinglan, IDS.facility.qinglanMain, 'users'))
      .expect(404);
  });

  it('prevents a facility manager from revoking organization-level access', async () => {
    const scope = await database.client.dataScope.findFirstOrThrow({
      where: {
        kind: 'FACILITY',
        facilityId: IDS.facility.qinglanMain,
        userRole: { userId: IDS.supervisorUser, revokedAt: null },
      },
      select: { id: true, scopeKey: true },
    });
    await database.client.dataScope.update({
      where: { id: scope.id },
      data: {
        kind: 'ORGANIZATION',
        scopeKey: `organization:${IDS.organization.qinglan}`,
        facilityId: null,
      },
    });

    try {
      const director = request.agent(server);
      const loggedIn = await login(director, 'facility.director');
      const users = await director
        .get(facilityPath(IDS.organization.qinglan, IDS.facility.qinglanMain, 'users'))
        .query({ search: 'nursing.supervisor' })
        .expect(200);
      const user = (users.body as UsersPage).items[0];
      await director
        .put(facilityPath(
          IDS.organization.qinglan,
          IDS.facility.qinglanMain,
          `users/${IDS.supervisorUser}/access`,
        ))
        .set('Origin', ORIGIN)
        .set('x-csrf-token', readCsrfToken(loggedIn))
        .send({
          organizationId: IDS.organization.qinglan,
          expectedAccessVersion: user?.accessVersion,
          assignments: [],
        })
        .expect(403)
        .expect(({ body }: Response) => {
          expect(body).toMatchObject({ error: { code: 'FORBIDDEN' } });
        });
      const unchanged = await database.client.user.findUniqueOrThrow({
        where: { id: IDS.supervisorUser },
        select: { accessVersion: true },
      });
      expect(unchanged.accessVersion).toBe(user?.accessVersion);
    } finally {
      await database.client.dataScope.update({
        where: { id: scope.id },
        data: {
          kind: 'FACILITY',
          scopeKey: scope.scopeKey,
          facilityId: IDS.facility.qinglanMain,
        },
      });
    }
  });

  it('invalidates old sessions immediately after an audited role and scope replacement', async () => {
    const supervisor = request.agent(server);
    await login(supervisor, 'nursing.supervisor');

    const director = request.agent(server);
    const directorLogin = await login(director, 'facility.director');
    const csrfToken = readCsrfToken(directorLogin);
    const users = await director
      .get(facilityPath(IDS.organization.qinglan, IDS.facility.qinglanMain, 'users'))
      .query({ search: 'nursing.supervisor' })
      .expect(200);
    const user = (users.body as UsersPage).items[0];
    expect(user?.id).toBe(IDS.supervisorUser);
    const [caregiverRole, supervisorRole] = await Promise.all([
      database.client.role.findUniqueOrThrow({ where: { code: 'CAREGIVER' }, select: { id: true } }),
      database.client.role.findUniqueOrThrow({ where: { code: 'NURSING_SUPERVISOR' }, select: { id: true } }),
    ]);

    const changed = await director
      .put(facilityPath(
        IDS.organization.qinglan,
        IDS.facility.qinglanMain,
        `users/${IDS.supervisorUser}/access`,
      ))
      .set('Origin', ORIGIN)
      .set('x-csrf-token', csrfToken)
      .send({
        organizationId: IDS.organization.qinglan,
        expectedAccessVersion: user?.accessVersion,
        assignments: [
          {
            roleId: caregiverRole.id,
            scopes: [
              {
                kind: 'FACILITY',
                scopeKey: `facility:${IDS.facility.qinglanMain}`,
                facilityId: IDS.facility.qinglanMain,
              },
            ],
          },
        ],
      })
      .expect(200);
    expect((changed.body as UserSummary).assignments[0]?.role.code).toBe('CAREGIVER');
    expect((changed.body as UserSummary).accessVersion).toBe((user?.accessVersion ?? 0) + 1);

    await supervisor.get('/auth/session').expect(401);
    const newLogin = await login(request.agent(server), 'nursing.supervisor');
    expect((newLogin.body as SessionContext).portal).toBe('caregiver');

    const changedUser = changed.body as UserSummary;
    await director
      .put(facilityPath(
        IDS.organization.qinglan,
        IDS.facility.qinglanMain,
        `users/${IDS.supervisorUser}/access`,
      ))
      .set('Origin', ORIGIN)
      .set('x-csrf-token', csrfToken)
      .send({
        organizationId: IDS.organization.qinglan,
        expectedAccessVersion: changedUser.accessVersion,
        assignments: [
          {
            roleId: supervisorRole.id,
            scopes: [
              {
                kind: 'FACILITY',
                scopeKey: `facility:${IDS.facility.qinglanMain}`,
                facilityId: IDS.facility.qinglanMain,
              },
            ],
          },
        ],
      })
      .expect(200);
    const restored = await login(request.agent(server), 'nursing.supervisor');
    expect((restored.body as SessionContext).portal).toBe('admin');
  });

  it('revokes logout and requires same-origin CSRF on state-changing requests', async () => {
    const agent = request.agent(server);
    const loggedIn = await login(agent, 'facility.director');
    const csrfToken = readCsrfToken(loggedIn);
    await agent.post('/auth/logout').set('Origin', 'https://evil.example').set('x-csrf-token', csrfToken).expect(403);
    await agent.get('/auth/session').expect(200);
    await agent.post('/auth/logout').set('Origin', ORIGIN).set('x-csrf-token', csrfToken).expect(200);
    await agent.get('/auth/session').expect(401);
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
  const headers: unknown = response.headers;
  const cookies = isRecord(headers) ? headers['set-cookie'] : undefined;
  const values = Array.isArray(cookies)
    ? cookies.filter((value): value is string => typeof value === 'string')
    : typeof cookies === 'string'
      ? [cookies]
      : [];
  const cookie = values.find((value) => value.startsWith('eldercare_csrf='));
  const token = cookie?.split(';', 1)[0]?.split('=', 2)[1];
  if (token === undefined) throw new Error('CSRF cookie was not set');
  return token;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function facilityPath(organizationId: string, facilityId: string, suffix: string): string {
  return `/admin/organizations/${organizationId}/facilities/${facilityId}/${suffix}`;
}

function errorSignature(response: Response): unknown {
  const body = response.body as { error?: { code?: string; message?: string } };
  return { status: response.status, code: body.error?.code, message: body.error?.message };
}

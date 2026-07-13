import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

import {
  M01_PERMISSIONS,
  ROLE_CODES,
  type M01Permission,
  type Role,
} from '@eldercare/authz';
import { hashPassword } from '@eldercare/authz/server';

import { createPrismaClient } from '../src/index.js';
import { assertDemoSeedAllowed } from '../src/seed-policy.js';

const rootEnvironmentFile = new URL('../../../.env', import.meta.url);
if (existsSync(rootEnvironmentFile)) loadEnvFile(rootEnvironmentFile);
const demoAssignmentActiveFrom = new Date('2020-01-01T00:00:00.000Z');
const seedStartedAt = Date.now();
const demoShiftValidFrom = new Date(seedStartedAt - 60 * 60 * 1000);
const demoShiftValidUntil = new Date(seedStartedAt + 11 * 60 * 60 * 1000);

const ids = {
  organizations: {
    platform: '10000000-0000-4000-8000-000000000001',
    qinglan: '10000000-0000-4000-8000-000000000002',
    songhe: '10000000-0000-4000-8000-000000000003',
  },
  facilities: {
    qinglanMain: '20000000-0000-4000-8000-000000000001',
    qinglanEast: '20000000-0000-4000-8000-000000000002',
    songheMain: '20000000-0000-4000-8000-000000000003',
  },
  users: {
    platformAdmin: '30000000-0000-4000-8000-000000000001',
    facilityDirector: '30000000-0000-4000-8000-000000000002',
    supervisor: '30000000-0000-4000-8000-000000000003',
    caregiver: '30000000-0000-4000-8000-000000000004',
    deviceManager: '30000000-0000-4000-8000-000000000005',
    elder: '30000000-0000-4000-8000-000000000006',
    family: '30000000-0000-4000-8000-000000000007',
  },
  auditSeed: '90000000-0000-4000-8000-000000000001',
} as const;

const roleIds = Object.fromEntries(
  ROLE_CODES.map((role, index) => [
    role,
    `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  ]),
) as Record<Role, string>;

const permissionDefinitions = [
  [M01_PERMISSIONS.SESSION_SELF_READ, '查看当前会话'],
  [M01_PERMISSIONS.SESSION_SELF_MANAGE, '管理本人会话'],
  [M01_PERMISSIONS.ORGANIZATION_READ, '查看授权机构'],
  [M01_PERMISSIONS.FACILITY_READ, '查看授权院区'],
  [M01_PERMISSIONS.USER_READ, '查看授权用户'],
  [M01_PERMISSIONS.ROLE_READ, '查看角色与权限'],
  [M01_PERMISSIONS.ACCESS_ASSIGNMENT_MANAGE, '管理用户访问授权'],
  [M01_PERMISSIONS.AUDIT_READ, '查看授权审计事件'],
] as const;

const permissionIds = Object.fromEntries(
  permissionDefinitions.map(([permission], index) => [
    permission,
    `50000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  ]),
) as Record<M01Permission, string>;

const roleLabels: Record<Role, string> = {
  PLATFORM_ADMIN: '平台管理员',
  ORG_ADMIN: '机构管理员',
  FACILITY_DIRECTOR: '院区负责人',
  NURSING_SUPERVISOR: '护理主管',
  CAREGIVER: '护工',
  CLINICAL_STAFF: '医护人员',
  DEVICE_MANAGER: '设备管理员',
  CONTENT_EDITOR: '内容运营',
  ACTIVITY_COORDINATOR: '活动运营',
  SERVICE_OPERATOR: '服务运营',
  PROVIDER_STAFF: '服务商人员',
  FINANCE_VIEWER: '财务查看者',
  ELDER: '老人',
  FAMILY: '家属',
};

const allM01Permissions = permissionDefinitions.map(([permission]) => permission);
const rolePermissionMap: Partial<Record<Role, readonly M01Permission[]>> = {
  PLATFORM_ADMIN: allM01Permissions,
  ORG_ADMIN: allM01Permissions,
  FACILITY_DIRECTOR: allM01Permissions.filter(
    (permission) => permission !== M01_PERMISSIONS.ORGANIZATION_READ,
  ),
  NURSING_SUPERVISOR: [
    M01_PERMISSIONS.SESSION_SELF_READ,
    M01_PERMISSIONS.SESSION_SELF_MANAGE,
    M01_PERMISSIONS.FACILITY_READ,
    M01_PERMISSIONS.USER_READ,
    M01_PERMISSIONS.ROLE_READ,
  ],
};

const selfSessionPermissions = [
  M01_PERMISSIONS.SESSION_SELF_READ,
  M01_PERMISSIONS.SESSION_SELF_MANAGE,
] as const;

for (const role of ROLE_CODES) {
  if (rolePermissionMap[role] === undefined) rolePermissionMap[role] = selfSessionPermissions;
}

const users = [
  [ids.users.platformAdmin, 'platform.admin', '平台管理员（虚构演示）'],
  [ids.users.facilityDirector, 'facility.director', '院区负责人（虚构演示）'],
  [ids.users.supervisor, 'nursing.supervisor', '护理主管（虚构演示）'],
  [ids.users.caregiver, 'caregiver.demo', '护工（虚构演示）'],
  [ids.users.deviceManager, 'device.manager', '设备管理员（虚构演示）'],
  [ids.users.elder, 'elder.demo', '老人（虚构演示）'],
  [ids.users.family, 'family.demo', '家属（虚构演示）'],
] as const;

const assignments = [
  {
    id: '60000000-0000-4000-8000-000000000001',
    userId: ids.users.platformAdmin,
    role: 'PLATFORM_ADMIN',
    organizationId: ids.organizations.platform,
    scopes: [{ id: '70000000-0000-4000-8000-000000000001', kind: 'PLATFORM', scopeKey: 'platform' }],
  },
  {
    id: '60000000-0000-4000-8000-000000000002',
    userId: ids.users.facilityDirector,
    role: 'FACILITY_DIRECTOR',
    organizationId: ids.organizations.qinglan,
    scopes: [{ id: '70000000-0000-4000-8000-000000000002', kind: 'FACILITY', scopeKey: `facility:${ids.facilities.qinglanMain}`, facilityId: ids.facilities.qinglanMain }],
  },
  {
    id: '60000000-0000-4000-8000-000000000003',
    userId: ids.users.supervisor,
    role: 'NURSING_SUPERVISOR',
    organizationId: ids.organizations.qinglan,
    scopes: [{ id: '70000000-0000-4000-8000-000000000003', kind: 'FACILITY', scopeKey: `facility:${ids.facilities.qinglanMain}`, facilityId: ids.facilities.qinglanMain }],
  },
  {
    id: '60000000-0000-4000-8000-000000000004',
    userId: ids.users.caregiver,
    role: 'CAREGIVER',
    organizationId: ids.organizations.qinglan,
    scopes: [{
      id: '70000000-0000-4000-8000-000000000004',
      kind: 'ACTIVE_SHIFT',
      scopeKey: 'active-shift',
      facilityId: ids.facilities.qinglanMain,
      validFrom: demoShiftValidFrom,
      validUntil: demoShiftValidUntil,
    }],
  },
  {
    id: '60000000-0000-4000-8000-000000000005',
    userId: ids.users.deviceManager,
    role: 'DEVICE_MANAGER',
    organizationId: ids.organizations.qinglan,
    scopes: [{ id: '70000000-0000-4000-8000-000000000005', kind: 'FACILITY', scopeKey: `facility:${ids.facilities.qinglanEast}`, facilityId: ids.facilities.qinglanEast }],
  },
  {
    id: '60000000-0000-4000-8000-000000000006',
    userId: ids.users.elder,
    role: 'ELDER',
    organizationId: ids.organizations.qinglan,
    scopes: [
      {
        id: '70000000-0000-4000-8000-000000000006',
        kind: 'OWN_RECORD',
        scopeKey: 'own-record',
      },
      {
        id: '70000000-0000-4000-8000-000000000008',
        kind: 'FACILITY',
        scopeKey: `facility:${ids.facilities.qinglanMain}`,
        facilityId: ids.facilities.qinglanMain,
      },
    ],
  },
  {
    id: '60000000-0000-4000-8000-000000000007',
    userId: ids.users.family,
    role: 'FAMILY',
    organizationId: ids.organizations.qinglan,
    scopes: [
      {
        id: '70000000-0000-4000-8000-000000000007',
        kind: 'OWN_RECORD',
        scopeKey: 'own-record',
      },
      {
        id: '70000000-0000-4000-8000-000000000009',
        kind: 'FACILITY',
        scopeKey: `facility:${ids.facilities.qinglanMain}`,
        facilityId: ids.facilities.qinglanMain,
      },
    ],
  },
] as const;

async function seed(): Promise<void> {
  assertDemoSeedAllowed(process.env);

  const demoPassword = process.env['M01_DEMO_PASSWORD'] ?? 'LocalDemoOnly!2026';
  const passwordHashes: string[] = [];
  for (let index = 0; index < users.length; index += 1) {
    passwordHashes.push(await hashPassword(demoPassword));
  }
  const prisma = createPrismaClient();

  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.organization.upsert({
        where: { id: ids.organizations.platform },
        create: { id: ids.organizations.platform, slug: 'platform-system', name: '平台运维组织（虚构）' },
        update: { slug: 'platform-system', name: '平台运维组织（虚构）', status: 'ACTIVE' },
      });
      await transaction.organization.upsert({
        where: { id: ids.organizations.qinglan },
        create: { id: ids.organizations.qinglan, slug: 'qinglan-demo', name: '青岚颐养中心（虚构）' },
        update: { slug: 'qinglan-demo', name: '青岚颐养中心（虚构）', status: 'ACTIVE' },
      });
      await transaction.organization.upsert({
        where: { id: ids.organizations.songhe },
        create: { id: ids.organizations.songhe, slug: 'songhe-demo', name: '松鹤颐养中心（虚构）' },
        update: { slug: 'songhe-demo', name: '松鹤颐养中心（虚构）', status: 'ACTIVE' },
      });

      for (const [id, organizationId, code, name] of [
        [ids.facilities.qinglanMain, ids.organizations.qinglan, 'QL-MAIN', '青岚主院区（虚构）'],
        [ids.facilities.qinglanEast, ids.organizations.qinglan, 'QL-EAST', '青岚东院区（虚构）'],
        [ids.facilities.songheMain, ids.organizations.songhe, 'SH-MAIN', '松鹤主院区（虚构）'],
      ] as const) {
        await transaction.facility.upsert({
          where: { id },
          create: { id, organizationId, code, name, timezone: 'Asia/Shanghai' },
          update: { organizationId, code, name, timezone: 'Asia/Shanghai', status: 'ACTIVE' },
        });
      }

      for (const role of ROLE_CODES) {
        await transaction.role.upsert({
          where: { id: roleIds[role] },
          create: { id: roleIds[role], code: role, name: roleLabels[role], isSystem: true },
          update: { code: role, name: roleLabels[role], isSystem: true },
        });
      }

      for (const [permission, name] of permissionDefinitions) {
        await transaction.permission.upsert({
          where: { id: permissionIds[permission] },
          create: { id: permissionIds[permission], code: permission, name },
          update: { code: permission, name },
        });
      }

      for (const role of ROLE_CODES) {
        await transaction.rolePermission.deleteMany({ where: { roleId: roleIds[role] } });
        await transaction.rolePermission.createMany({
          data: (rolePermissionMap[role] ?? []).map((permission) => ({
            roleId: roleIds[role],
            permissionId: permissionIds[permission],
          })),
        });
      }

      for (const [index, [id, loginName, displayName]] of users.entries()) {
        await transaction.user.upsert({
          where: { id },
          create: {
            id,
            loginName,
            normalizedLoginName: loginName.trim().toLowerCase(),
            displayName,
          },
          update: {
            loginName,
            normalizedLoginName: loginName.trim().toLowerCase(),
            displayName,
            status: 'ACTIVE',
          },
        });
        await transaction.passwordCredential.upsert({
          where: { userId: id },
          create: { userId: id, passwordHash: passwordHashes[index] ?? '' },
          update: {
            passwordHash: passwordHashes[index] ?? '',
            failedLoginCount: 0,
            lockedUntil: null,
            passwordChangedAt: new Date(),
          },
        });
      }

      for (const assignment of assignments) {
        await transaction.userRole.upsert({
          where: { id: assignment.id },
          create: {
            id: assignment.id,
            userId: assignment.userId,
            roleId: roleIds[assignment.role],
            organizationId: assignment.organizationId,
            activeFrom: demoAssignmentActiveFrom,
            createdByUserId: ids.users.platformAdmin,
          },
          update: {
            userId: assignment.userId,
            roleId: roleIds[assignment.role],
            organizationId: assignment.organizationId,
            activeFrom: demoAssignmentActiveFrom,
            expiresAt: null,
            revokedAt: null,
            revokedByUserId: null,
          },
        });

        await transaction.dataScope.deleteMany({ where: { userRoleId: assignment.id } });
        for (const scope of assignment.scopes) {
          await transaction.dataScope.create({
            data: {
              id: scope.id,
              userRoleId: assignment.id,
              organizationId: assignment.organizationId,
              kind: scope.kind,
              scopeKey: scope.scopeKey,
              facilityId: 'facilityId' in scope ? scope.facilityId : undefined,
              validFrom: 'validFrom' in scope ? scope.validFrom : demoAssignmentActiveFrom,
              validUntil: 'validUntil' in scope ? scope.validUntil : undefined,
            },
          });
        }
      }

      await transaction.auditEvent.createMany({
        data: [{
          id: ids.auditSeed,
          organizationId: ids.organizations.platform,
          actorUserId: ids.users.platformAdmin,
          actorType: 'USER',
          action: 'SYSTEM.M01_SEED_APPLIED',
          outcome: 'SUCCESS',
          resourceType: 'milestone',
          resourceId: 'M01',
          correlationId: 'seed-m01-auth-rbac',
          safeMetadata: { fictionalDemoData: true, schemaVersion: '1.1' },
        }],
        skipDuplicates: true,
      });

      await transaction.systemMetadata.upsert({
        where: { key: 'foundation.seed' },
        create: {
          key: 'foundation.seed',
          value: { schemaVersion: '1.1', milestone: 'M01', containsBusinessFixtures: true },
        },
        update: {
          value: { schemaVersion: '1.1', milestone: 'M01', containsBusinessFixtures: true },
        },
      });
    });
  } finally {
    await prisma.$disconnect();
  }
}

void seed().catch(() => {
  console.error('Database seed failed. Check the database service logs for safe diagnostics.');
  process.exitCode = 1;
});

import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

import {
  M01_PERMISSIONS,
  M02_PERMISSIONS,
  ROLE_CODES,
  type M01Permission,
  type M02Permission,
  type Role,
} from '@eldercare/authz';
import { hashPassword } from '@eldercare/authz/server';

import { createPrismaClient, type Prisma } from '../src/index.js';
import { assertDemoSeedAllowed } from '../src/seed-policy.js';

const rootEnvironmentFile = new URL('../../../.env', import.meta.url);
if (existsSync(rootEnvironmentFile)) loadEnvFile(rootEnvironmentFile);

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const seedStartedAt = Date.now();
const seedNow = new Date(seedStartedAt);
const demoAssignmentActiveFrom = new Date('2020-01-01T00:00:00.000Z');
const demoShiftValidFrom = new Date(seedStartedAt - HOUR);
const demoShiftValidUntil = new Date(seedStartedAt + 7 * HOUR);
const activeShiftAuthorizationWindow = {
  validFrom: demoShiftValidFrom,
  validUntil: demoShiftValidUntil,
};

function fixedId(prefix: string, index: number): string {
  return `${prefix}-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

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
  auditM01: '90000000-0000-4000-8000-000000000001',
  auditM02: '90000000-0000-4000-8000-000000000002',
} as const;

const buildingIds = [fixedId('81000000', 1), fixedId('81000000', 2)] as const;
const floorIds = Array.from({ length: 4 }, (_, index) => fixedId('82000000', index + 1));
const zoneIds = Array.from({ length: 8 }, (_, index) => fixedId('83000000', index + 1));
const roomIds = Array.from({ length: 8 }, (_, index) => fixedId('84000000', index + 1));
const bedIds = Array.from({ length: 16 }, (_, index) => fixedId('85000000', index + 1));
const careLevelIds = Array.from({ length: 3 }, (_, index) => fixedId('86000000', index + 1));
const elderIds = Array.from({ length: 12 }, (_, index) => fixedId('87000000', index + 1));
const teamIds = [fixedId('93000000', 1), fixedId('93000000', 2)] as const;

const caregiverUserIds = [
  ids.users.caregiver,
  ...Array.from({ length: 7 }, (_, index) => fixedId('30000000', index + 8)),
];
const familyUserIds = [
  ids.users.family,
  fixedId('30000000', 15),
  fixedId('30000000', 16),
];
const caregiverStaffIds = caregiverUserIds.map((_, index) => fixedId('92000000', index + 3));

const roleIds = Object.fromEntries(
  ROLE_CODES.map((role, index) => [role, fixedId('40000000', index + 1)]),
) as Record<Role, string>;

type SeedPermission = M01Permission | M02Permission;

const permissionDefinitions: readonly (readonly [SeedPermission, string])[] = [
  [M01_PERMISSIONS.SESSION_SELF_READ, '查看当前会话'],
  [M01_PERMISSIONS.SESSION_SELF_MANAGE, '管理本人会话'],
  [M01_PERMISSIONS.ORGANIZATION_READ, '查看授权机构'],
  [M01_PERMISSIONS.FACILITY_READ, '查看授权院区'],
  [M01_PERMISSIONS.USER_READ, '查看授权用户'],
  [M01_PERMISSIONS.ROLE_READ, '查看角色与权限'],
  [M01_PERMISSIONS.ACCESS_ASSIGNMENT_MANAGE, '管理用户访问授权'],
  [M01_PERMISSIONS.AUDIT_READ, '查看授权审计事件'],
  [M02_PERMISSIONS.FACILITY_DIRECTORY_READ, '查看院区目录'],
  [M02_PERMISSIONS.FACILITY_DIRECTORY_MANAGE, '管理院区目录'],
  [M02_PERMISSIONS.CARE_LEVEL_READ, '查看照护等级'],
  [M02_PERMISSIONS.CARE_LEVEL_MANAGE, '管理照护等级'],
  [M02_PERMISSIONS.ELDER_CREATE, '创建长者档案'],
  [M02_PERMISSIONS.ELDER_READ_BASIC, '查看长者基本信息'],
  [M02_PERMISSIONS.ELDER_READ_SENSITIVE, '查看长者敏感信息'],
  [M02_PERMISSIONS.ELDER_UPDATE, '更新长者档案'],
  [M02_PERMISSIONS.ELDER_STAY_MANAGE, '管理长者住养记录'],
  [M02_PERMISSIONS.ELDER_RELATIONSHIP_MANAGE, '管理家属关系'],
  [M02_PERMISSIONS.ELDER_TIMELINE_READ, '查看长者时间线'],
  [M02_PERMISSIONS.CONSENT_MANAGE, '管理长者同意记录'],
  [M02_PERMISSIONS.STAFF_READ, '查看员工档案'],
  [M02_PERMISSIONS.STAFF_MANAGE, '管理员工档案'],
  [M02_PERMISSIONS.SHIFT_READ, '查看排班'],
  [M02_PERMISSIONS.SHIFT_MANAGE, '管理排班'],
];

const permissionIds = Object.fromEntries(
  permissionDefinitions.map(([permission], index) => [permission, fixedId('50000000', index + 1)]),
) as Record<SeedPermission, string>;

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
  ELDER: '长者',
  FAMILY: '家属',
};

const allPermissions = permissionDefinitions.map(([permission]) => permission);
const selfSessionPermissions = [
  M01_PERMISSIONS.SESSION_SELF_READ,
  M01_PERMISSIONS.SESSION_SELF_MANAGE,
] as const;
const rolePermissionMap: Partial<Record<Role, readonly SeedPermission[]>> = {
  PLATFORM_ADMIN: allPermissions,
  ORG_ADMIN: allPermissions,
  FACILITY_DIRECTOR: allPermissions.filter(
    (permission) => permission !== M01_PERMISSIONS.ORGANIZATION_READ,
  ),
  NURSING_SUPERVISOR: [
    ...selfSessionPermissions,
    M01_PERMISSIONS.FACILITY_READ,
    M01_PERMISSIONS.USER_READ,
    M01_PERMISSIONS.ROLE_READ,
    ...Object.values(M02_PERMISSIONS),
  ],
  CAREGIVER: [
    ...selfSessionPermissions,
    M01_PERMISSIONS.FACILITY_READ,
    M02_PERMISSIONS.ELDER_READ_BASIC,
    M02_PERMISSIONS.ELDER_TIMELINE_READ,
  ],
  DEVICE_MANAGER: [
    ...selfSessionPermissions,
    M01_PERMISSIONS.FACILITY_READ,
  ],
  ELDER: [
    ...selfSessionPermissions,
    M01_PERMISSIONS.FACILITY_READ,
    M02_PERMISSIONS.ELDER_READ_BASIC,
    M02_PERMISSIONS.ELDER_READ_SENSITIVE,
    M02_PERMISSIONS.ELDER_TIMELINE_READ,
    M02_PERMISSIONS.CONSENT_MANAGE,
  ],
  FAMILY: [
    ...selfSessionPermissions,
    M01_PERMISSIONS.FACILITY_READ,
    M02_PERMISSIONS.ELDER_READ_BASIC,
    M02_PERMISSIONS.ELDER_TIMELINE_READ,
  ],
};

for (const role of ROLE_CODES) {
  if (rolePermissionMap[role] === undefined) rolePermissionMap[role] = selfSessionPermissions;
}

const users: readonly (readonly [string, string, string])[] = [
  [ids.users.platformAdmin, 'platform.admin', '平台管理员（虚构演示）'],
  [ids.users.facilityDirector, 'facility.director', '院区负责人（虚构演示）'],
  [ids.users.supervisor, 'nursing.supervisor', '护理主管（虚构演示）'],
  ...caregiverUserIds.map((id, index): readonly [string, string, string] => [id, index === 0 ? 'caregiver.demo' : `caregiver.demo${index + 1}`, `虚构护工${String(index + 1).padStart(2, '0')}`]),
  [ids.users.deviceManager, 'device.manager', '设备管理员（虚构演示）'],
  [ids.users.elder, 'elder.demo', '虚构长者01'],
  ...familyUserIds.map((id, index): readonly [string, string, string] => [id, index === 0 ? 'family.demo' : `family.demo${index + 1}`, `虚构家属${String(index + 1).padStart(2, '0')}`]),
];

type ScopeFixture = {
  id: string;
  kind: 'PLATFORM' | 'FACILITY' | 'OWN_RECORD' | 'LINKED_ELDER';
  scopeKey: string;
  facilityId?: string;
  resourceType?: string;
  resourceId?: string;
};

type RoleAssignmentFixture = {
  id: string;
  userId: string;
  role: Role;
  organizationId: string;
  scopes: readonly ScopeFixture[];
};

const assignments: readonly RoleAssignmentFixture[] = [
  {
    id: fixedId('60000000', 1),
    userId: ids.users.platformAdmin,
    role: 'PLATFORM_ADMIN',
    organizationId: ids.organizations.platform,
    scopes: [{ id: fixedId('70000000', 1), kind: 'PLATFORM', scopeKey: 'platform' }],
  },
  {
    id: fixedId('60000000', 2),
    userId: ids.users.facilityDirector,
    role: 'FACILITY_DIRECTOR',
    organizationId: ids.organizations.qinglan,
    scopes: [{ id: fixedId('70000000', 2), kind: 'FACILITY', scopeKey: `facility:${ids.facilities.qinglanMain}`, facilityId: ids.facilities.qinglanMain }],
  },
  {
    id: fixedId('60000000', 3),
    userId: ids.users.supervisor,
    role: 'NURSING_SUPERVISOR',
    organizationId: ids.organizations.qinglan,
    scopes: [{ id: fixedId('70000000', 3), kind: 'FACILITY', scopeKey: `facility:${ids.facilities.qinglanMain}`, facilityId: ids.facilities.qinglanMain }],
  },
  ...caregiverUserIds.map((userId, index) => ({
    id: fixedId('60000000', index === 0 ? 4 : index + 7),
    userId,
    role: 'CAREGIVER' as const,
    organizationId: ids.organizations.qinglan,
    scopes: [],
  })),
  {
    id: fixedId('60000000', 5),
    userId: ids.users.deviceManager,
    role: 'DEVICE_MANAGER',
    organizationId: ids.organizations.qinglan,
    scopes: [
      { id: fixedId('70000000', 5), kind: 'FACILITY', scopeKey: `facility:${ids.facilities.qinglanEast}`, facilityId: ids.facilities.qinglanEast },
      { id: fixedId('70000000', 10), kind: 'FACILITY', scopeKey: `facility:${ids.facilities.qinglanMain}`, facilityId: ids.facilities.qinglanMain },
    ],
  },
  {
    id: fixedId('60000000', 6),
    userId: ids.users.elder,
    role: 'ELDER',
    organizationId: ids.organizations.qinglan,
    scopes: [
      { id: fixedId('70000000', 6), kind: 'OWN_RECORD', scopeKey: 'own-record' },
      { id: fixedId('70000000', 8), kind: 'FACILITY', scopeKey: `facility:${ids.facilities.qinglanMain}`, facilityId: ids.facilities.qinglanMain },
    ],
  },
  ...familyUserIds.map((userId, index) => ({
    id: fixedId('60000000', index === 0 ? 7 : index + 14),
    userId,
    role: 'FAMILY' as const,
    organizationId: ids.organizations.qinglan,
    scopes: [
      { id: fixedId('70000000', index === 0 ? 7 : index + 11), kind: 'OWN_RECORD' as const, scopeKey: 'own-record' },
      ...(index === 0
        ? [{ id: fixedId('70000000', 9), kind: 'LINKED_ELDER' as const, scopeKey: `linked-elder:${elderIds[0]}`, facilityId: ids.facilities.qinglanMain, resourceType: 'ELDER', resourceId: elderIds[0] }]
        : []),
    ],
  })),
];

const M02_SEED_EXPECTATIONS = {
  buildings: 2,
  floors: 4,
  zones: 8,
  rooms: 8,
  beds: 16,
  occupiedBeds: 12,
  elders: 12,
  careLevels: 3,
  staffProfiles: 10,
  caregivers: 8,
  familyAccounts: 3,
  shifts: 17,
  shiftAssignments: 17,
  shiftAssignmentScopes: 17,
} as const;

function startOfShanghaiWeek(timestamp: number): number {
  const shanghaiOffset = 8 * HOUR;
  const local = new Date(timestamp + shanghaiOffset);
  const daysSinceMonday = (local.getUTCDay() + 6) % 7;
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - daysSinceMonday) - shanghaiOffset;
}

type ShiftFixture = {
  id: string;
  code: string;
  name: string;
  teamId: string;
  startsAt: Date;
  endsAt: Date;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  assignmentStatus: 'ASSIGNED' | 'ACCEPTED' | 'CANCELLED';
  assignedAt: Date;
  caregiverIndex: number;
  floorIndex: number;
  zoneIndex: number;
  elderIndex: number;
  authorizationEndsAt: Date;
};

const cancelledAt = new Date(seedStartedAt - 2 * HOUR);
const explicitShifts: ShiftFixture[] = [
  {
    id: fixedId('95000000', 1),
    code: 'SHIFT-CURRENT',
    name: '当前在岗班次（虚构）',
    teamId: teamIds[0],
    startsAt: demoShiftValidFrom,
    endsAt: demoShiftValidUntil,
    status: 'IN_PROGRESS',
    assignmentStatus: 'ACCEPTED',
    assignedAt: new Date(seedStartedAt - 2 * HOUR),
    caregiverIndex: 0,
    floorIndex: 0,
    zoneIndex: 0,
    elderIndex: 0,
    authorizationEndsAt: demoShiftValidUntil,
  },
  {
    id: fixedId('95000000', 2),
    code: 'SHIFT-EXPIRED',
    name: '已结束班次（虚构）',
    teamId: teamIds[0],
    startsAt: new Date(seedStartedAt - 3 * DAY),
    endsAt: new Date(seedStartedAt - 3 * DAY + 8 * HOUR),
    status: 'COMPLETED',
    assignmentStatus: 'ACCEPTED',
    assignedAt: new Date(seedStartedAt - 4 * DAY),
    caregiverIndex: 1,
    floorIndex: 1,
    zoneIndex: 2,
    elderIndex: 3,
    authorizationEndsAt: new Date(seedStartedAt - 3 * DAY + 8 * HOUR),
  },
  {
    id: fixedId('95000000', 3),
    code: 'SHIFT-CANCELLED',
    name: '已取消班次（虚构）',
    teamId: teamIds[1],
    startsAt: new Date(seedStartedAt - 4 * HOUR),
    endsAt: new Date(seedStartedAt + 4 * HOUR),
    status: 'CANCELLED',
    assignmentStatus: 'CANCELLED',
    assignedAt: new Date(seedStartedAt - 6 * HOUR),
    caregiverIndex: 2,
    floorIndex: 2,
    zoneIndex: 4,
    elderIndex: 6,
    authorizationEndsAt: cancelledAt,
  },
];

const weekStart = startOfShanghaiWeek(seedStartedAt);
const weeklyShifts = Array.from({ length: 14 }, (_, index): ShiftFixture => {
  const dayIndex = Math.floor(index / 2);
  const isMorning = index % 2 === 0;
  const startsAt = new Date(weekStart + dayIndex * DAY + (isMorning ? 8 : 16) * HOUR);
  const endsAt = new Date(startsAt.getTime() + 8 * HOUR);
  const status = endsAt.getTime() <= seedStartedAt
    ? 'COMPLETED'
    : startsAt.getTime() <= seedStartedAt
      ? 'IN_PROGRESS'
      : 'SCHEDULED';
  const floorIndex = index % floorIds.length;
  return {
    id: fixedId('95000000', index + 4),
    code: `SHIFT-W${String(dayIndex + 1).padStart(2, '0')}-${isMorning ? 'AM' : 'PM'}`,
    name: `周排班第${dayIndex + 1}天${isMorning ? '早班' : '晚班'}（虚构）`,
    teamId: teamIds[floorIndex < 2 ? 0 : 1],
    startsAt,
    endsAt,
    status,
    assignmentStatus: status === 'SCHEDULED' ? 'ASSIGNED' : 'ACCEPTED',
    assignedAt: new Date(startsAt.getTime() - DAY),
    caregiverIndex: (index + 3) % caregiverUserIds.length,
    floorIndex,
    zoneIndex: floorIndex * 2 + (index % 2),
    elderIndex: index % elderIds.length,
    authorizationEndsAt: endsAt,
  };
});
const shiftFixtures = [...explicitShifts, ...weeklyShifts];

async function seed(): Promise<void> {
  assertDemoSeedAllowed(process.env);

  const demoPassword = process.env['M01_DEMO_PASSWORD'] ?? 'LocalDemoOnly!2026';
  const demoPasswordHash = await hashPassword(demoPassword);
  const prisma = createPrismaClient();

  try {
    await prisma.$transaction(async (transaction) => {
      for (const [id, slug, name] of [
        [ids.organizations.platform, 'platform-system', '平台运维组织（虚构）'],
        [ids.organizations.qinglan, 'qinglan-demo', '青岚颐养中心（虚构）'],
        [ids.organizations.songhe, 'songhe-demo', '松鹤颐养中心（虚构）'],
      ] as const) {
        await transaction.organization.upsert({
          where: { id },
          create: { id, slug, name },
          update: { slug, name, status: 'ACTIVE' },
        });
      }

      for (const [id, organizationId, code, name] of [
        [ids.facilities.qinglanMain, ids.organizations.qinglan, 'QL-MAIN', '青岚主院区（虚构）'],
        [ids.facilities.qinglanEast, ids.organizations.qinglan, 'QL-EAST', '青岚东院区（隔离样本）'],
        [ids.facilities.songheMain, ids.organizations.songhe, 'SH-MAIN', '松鹤主院区（跨租户隔离样本）'],
      ] as const) {
        await transaction.facility.upsert({
          where: { id },
          create: { id, organizationId, code, name, timezone: 'Asia/Shanghai' },
          update: { organizationId, code, name, timezone: 'Asia/Shanghai', status: 'ACTIVE' },
        });
      }

      const mainFacilityFilter = {
        organizationId: ids.organizations.qinglan,
        facilityId: ids.facilities.qinglanMain,
      };
      await transaction.elderTimelineEntry.deleteMany({ where: mainFacilityFilter });
      await transaction.elderCareAssignment.deleteMany({ where: mainFacilityFilter });
      await transaction.shiftAssignmentScope.deleteMany({ where: mainFacilityFilter });
      await transaction.shiftAssignment.deleteMany({ where: mainFacilityFilter });
      await transaction.shift.deleteMany({ where: mainFacilityFilter });
      await transaction.teamMembership.deleteMany({ where: mainFacilityFilter });
      await transaction.sharingPreference.deleteMany({ where: mainFacilityFilter });
      await transaction.personalBaseline.deleteMany({ where: mainFacilityFilter });
      await transaction.consentRecord.deleteMany({ where: mainFacilityFilter });
      await transaction.communicationPreference.deleteMany({ where: mainFacilityFilter });
      await transaction.accessibilityProfile.deleteMany({ where: mainFacilityFilter });
      await transaction.emergencyContact.deleteMany({ where: mainFacilityFilter });
      await transaction.familyRelationship.deleteMany({ where: mainFacilityFilter });
      await transaction.elderStay.deleteMany({ where: mainFacilityFilter });
      await transaction.admissionRecord.deleteMany({ where: mainFacilityFilter });
      await transaction.elder.deleteMany({ where: mainFacilityFilter });
      await transaction.staffProfile.deleteMany({ where: mainFacilityFilter });
      await transaction.team.deleteMany({ where: mainFacilityFilter });
      await transaction.careLevel.deleteMany({ where: mainFacilityFilter });
      await transaction.bed.deleteMany({ where: mainFacilityFilter });
      await transaction.room.deleteMany({ where: mainFacilityFilter });
      await transaction.zone.deleteMany({ where: mainFacilityFilter });
      await transaction.floor.deleteMany({ where: mainFacilityFilter });
      await transaction.building.deleteMany({ where: mainFacilityFilter });

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

      for (const [id, loginName, displayName] of users) {
        await transaction.user.upsert({
          where: { id },
          create: { id, loginName, normalizedLoginName: loginName.toLowerCase(), displayName },
          update: { loginName, normalizedLoginName: loginName.toLowerCase(), displayName, status: 'ACTIVE' },
        });
        await transaction.passwordCredential.upsert({
          where: { userId: id },
          create: { userId: id, passwordHash: demoPasswordHash },
          update: {
            passwordHash: demoPasswordHash,
            failedLoginCount: 0,
            lockedUntil: null,
            passwordChangedAt: seedNow,
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
        if (assignment.scopes.length > 0) {
          await transaction.dataScope.createMany({
            data: assignment.scopes.map((scope) => ({
              id: scope.id,
              userRoleId: assignment.id,
              organizationId: assignment.organizationId,
              kind: scope.kind,
              scopeKey: scope.scopeKey,
              facilityId: scope.facilityId,
              resourceType: scope.resourceType,
              resourceId: scope.resourceId,
              validFrom: demoAssignmentActiveFrom,
            })),
          });
        }
      }

      const buildings: Prisma.BuildingCreateManyInput[] = buildingIds.map((id, index) => ({
        id,
        ...mainFacilityFilter,
        code: `B${index + 1}`,
        name: `${index + 1}号楼（虚构）`,
        sortOrder: index + 1,
      }));
      await transaction.building.createMany({ data: buildings });

      const floors: Prisma.FloorCreateManyInput[] = floorIds.map((id, index) => ({
        id,
        ...mainFacilityFilter,
        buildingId: buildingIds[Math.floor(index / 2)] ?? buildingIds[0],
        code: `F${index + 1}`,
        name: `${index + 1}层（虚构）`,
        levelNumber: (index % 2) + 1,
        sortOrder: index + 1,
      }));
      await transaction.floor.createMany({ data: floors });

      const zones: Prisma.ZoneCreateManyInput[] = zoneIds.map((id, index) => ({
        id,
        ...mainFacilityFilter,
        floorId: floorIds[Math.floor(index / 2)] ?? floorIds[0] ?? '',
        code: `Z${String(index + 1).padStart(2, '0')}`,
        name: `${index % 2 === 0 ? '东' : '西'}照护区（虚构）`,
        sortOrder: index + 1,
      }));
      await transaction.zone.createMany({ data: zones });

      const rooms: Prisma.RoomCreateManyInput[] = roomIds.map((id, index) => ({
        id,
        ...mainFacilityFilter,
        floorId: floorIds[Math.floor(index / 2)] ?? floorIds[0] ?? '',
        zoneId: zoneIds[index],
        code: `R${String(index + 1).padStart(3, '0')}`,
        name: `${101 + index}室（虚构）`,
      }));
      await transaction.room.createMany({ data: rooms });

      const beds: Prisma.BedCreateManyInput[] = bedIds.map((id, index) => ({
        id,
        ...mainFacilityFilter,
        roomId: roomIds[Math.floor(index / 2)] ?? roomIds[0] ?? '',
        code: `BED-${String(index + 1).padStart(3, '0')}`,
        label: `${Math.floor(index / 2) + 101}-${index % 2 === 0 ? 'A' : 'B'}床`,
        operationalStatus: index === 15 ? 'OUT_OF_SERVICE' : 'ACTIVE',
      }));
      await transaction.bed.createMany({ data: beds });

      await transaction.careLevel.createMany({
        data: [
          { id: careLevelIds[0] ?? '', ...mainFacilityFilter, code: 'CARE-L1', name: '一级照护（虚构）', rank: 1, description: '日常提醒与基础协助。' },
          { id: careLevelIds[1] ?? '', ...mainFacilityFilter, code: 'CARE-L2', name: '二级照护（虚构）', rank: 2, description: '部分生活协助与定期巡视。' },
          { id: careLevelIds[2] ?? '', ...mainFacilityFilter, code: 'CARE-L3', name: '三级照护（虚构）', rank: 3, description: '较高频率的生活照护支持。' },
        ],
      });

      const elders: Prisma.ElderCreateManyInput[] = elderIds.map((id, index) => ({
        id,
        ...mainFacilityFilter,
        portalUserId: index === 0 ? ids.users.elder : null,
        recordNumber: `QL-E${String(index + 1).padStart(3, '0')}`,
        displayName: `虚构长者${String(index + 1).padStart(2, '0')}`,
        preferredName: `长者${String(index + 1).padStart(2, '0')}`,
        birthDate: new Date(Date.UTC(1940 + (index % 12), index % 12, 1)),
        currentCareLevelId: careLevelIds[index % careLevelIds.length],
        status: 'ACTIVE',
      }));
      await transaction.elder.createMany({ data: elders });

      const admissionRows: Prisma.AdmissionRecordCreateManyInput[] = elderIds.map((elderId, index) => ({
        id: fixedId('88000000', index + 1),
        ...mainFacilityFilter,
        elderId,
        admissionNumber: `QL-A${String(index + 1).padStart(3, '0')}`,
        status: 'ADMITTED',
        admittedAt: new Date(seedStartedAt - (60 + index) * DAY),
        admissionReasonCode: 'ROUTINE_ADMISSION',
      }));
      await transaction.admissionRecord.createMany({ data: admissionRows });

      const stayRows: Prisma.ElderStayCreateManyInput[] = elderIds.map((elderId, index) => ({
        id: fixedId('89000000', index + 1),
        ...mainFacilityFilter,
        admissionRecordId: fixedId('88000000', index + 1),
        elderId,
        bedId: bedIds[index] ?? '',
        status: 'ACTIVE',
        admittedAt: new Date(seedStartedAt - (60 + index) * DAY),
        admissionReasonCode: 'ROUTINE_ADMISSION',
      }));
      await transaction.elderStay.createMany({ data: stayRows });

      const relationshipRows: Prisma.FamilyRelationshipCreateManyInput[] = [
        {
          id: fixedId('8a000000', 1),
          ...mainFacilityFilter,
          elderId: elderIds[0] ?? '',
          familyUserId: familyUserIds[0] ?? '',
          relationshipKind: 'CHILD',
          relationshipLabel: '子女（虚构）',
          status: 'VERIFIED',
          activeFrom: new Date(seedStartedAt - 90 * DAY),
          verifiedAt: new Date(seedStartedAt - 80 * DAY),
          verifiedByUserId: ids.users.supervisor,
        },
        {
          id: fixedId('8a000000', 2),
          ...mainFacilityFilter,
          elderId: elderIds[1] ?? '',
          familyUserId: familyUserIds[1] ?? '',
          relationshipKind: 'SPOUSE',
          relationshipLabel: '配偶（虚构）',
          status: 'PENDING',
          activeFrom: new Date(seedStartedAt - 10 * DAY),
        },
        {
          id: fixedId('8a000000', 3),
          ...mainFacilityFilter,
          elderId: elderIds[2] ?? '',
          familyUserId: familyUserIds[2] ?? '',
          relationshipKind: 'GUARDIAN',
          relationshipLabel: '授权代表（虚构）',
          status: 'REVOKED',
          activeFrom: new Date(seedStartedAt - 120 * DAY),
          activeUntil: new Date(seedStartedAt - 20 * DAY),
          verifiedAt: new Date(seedStartedAt - 110 * DAY),
          revokedAt: new Date(seedStartedAt - 20 * DAY),
          verifiedByUserId: ids.users.supervisor,
        },
      ];
      await transaction.familyRelationship.createMany({ data: relationshipRows });

      const contactRows: Prisma.EmergencyContactCreateManyInput[] = elderIds.map((elderId, index) => ({
        id: fixedId('8b000000', index + 1),
        ...mainFacilityFilter,
        elderId,
        familyRelationshipId: index < 3 ? fixedId('8a000000', index + 1) : null,
        displayName: `虚构紧急联系人${String(index + 1).padStart(2, '0')}`,
        relationshipLabel: '演示联系人',
        contactValue: `contact${String(index + 1).padStart(2, '0')}@example.invalid`,
        priority: 1,
        isPrimary: true,
        active: true,
      }));
      await transaction.emergencyContact.createMany({ data: contactRows });

      const accessibilityRows: Prisma.AccessibilityProfileCreateManyInput[] = elderIds.map((elderId, index) => ({
        id: fixedId('8c000000', index + 1),
        ...mainFacilityFilter,
        elderId,
        preferredTextScale: index % 3 === 0 ? 'EXTRA_LARGE' : 'LARGE',
        highContrast: index % 4 === 0,
        reducedMotion: index % 2 === 0,
        hearingSupport: index % 3 === 0,
        visionSupport: index % 4 === 0,
        mobilitySupport: index % 2 === 1,
        preferredInputMode: index % 3 === 0 ? 'VOICE' : index % 3 === 1 ? 'TOUCH' : 'HUMAN_ASSISTED',
        humanHandoffPreferred: index % 3 === 2,
        notes: '仅用于虚构演示的无障碍偏好。',
      }));
      await transaction.accessibilityProfile.createMany({ data: accessibilityRows });

      const communicationRows: Prisma.CommunicationPreferenceCreateManyInput[] = elderIds.map((elderId, index) => ({
        id: fixedId('8d000000', index + 1),
        ...mainFacilityFilter,
        elderId,
        preferredLanguage: 'zh-CN',
        speakingPace: index % 2 === 0 ? 'SLOW' : 'STANDARD',
        repeatKeyInformation: index % 2 === 0,
        preferredChannel: index % 3 === 0 ? 'VOICE' : index % 3 === 1 ? 'IN_PERSON' : 'TEXT',
        quietHoursStart: new Date('1970-01-01T21:00:00.000Z'),
        quietHoursEnd: new Date('1970-01-01T07:00:00.000Z'),
      }));
      await transaction.communicationPreference.createMany({ data: communicationRows });

      await transaction.team.createMany({
        data: [
          { id: teamIds[0], ...mainFacilityFilter, code: 'TEAM-A', name: '暖阳照护组（虚构）', description: '服务1号楼的虚构照护团队。' },
          { id: teamIds[1], ...mainFacilityFilter, code: 'TEAM-B', name: '清风照护组（虚构）', description: '服务2号楼的虚构照护团队。' },
        ],
      });

      const staffRows: Prisma.StaffProfileCreateManyInput[] = [
        {
          id: fixedId('92000000', 1),
          ...mainFacilityFilter,
          userId: ids.users.supervisor,
          employeeCode: 'QL-SUP-01',
          displayName: '护理主管（虚构演示）',
          jobTitle: '护理主管',
          hiredAt: new Date('2024-01-01T00:00:00.000Z'),
          primaryTeamId: teamIds[0],
        },
        {
          id: fixedId('92000000', 2),
          ...mainFacilityFilter,
          userId: ids.users.deviceManager,
          employeeCode: 'QL-DEV-01',
          displayName: '设备管理员（虚构演示）',
          jobTitle: '设备管理员',
          hiredAt: new Date('2024-02-01T00:00:00.000Z'),
        },
        ...caregiverUserIds.map((userId, index) => ({
          id: caregiverStaffIds[index] ?? '',
          ...mainFacilityFilter,
          userId,
          employeeCode: `QL-CG-${String(index + 1).padStart(2, '0')}`,
          displayName: `虚构护工${String(index + 1).padStart(2, '0')}`,
          jobTitle: '照护员',
          hiredAt: new Date(`2024-${String((index % 9) + 1).padStart(2, '0')}-01T00:00:00.000Z`),
          primaryTeamId: teamIds[index < 4 ? 0 : 1],
        })),
      ];
      await transaction.staffProfile.createMany({ data: staffRows });

      const membershipRows: Prisma.TeamMembershipCreateManyInput[] = [
        {
          id: fixedId('94000000', 1),
          ...mainFacilityFilter,
          teamId: teamIds[0],
          staffProfileId: fixedId('92000000', 1),
          role: 'LEAD',
          activeFrom: demoAssignmentActiveFrom,
        },
        {
          id: fixedId('94000000', 2),
          ...mainFacilityFilter,
          teamId: teamIds[1],
          staffProfileId: fixedId('92000000', 1),
          role: 'LEAD',
          activeFrom: demoAssignmentActiveFrom,
        },
        ...caregiverStaffIds.map((staffProfileId, index) => ({
          id: fixedId('94000000', index + 3),
          ...mainFacilityFilter,
          teamId: teamIds[index < 4 ? 0 : 1],
          staffProfileId,
          role: 'MEMBER' as const,
          activeFrom: demoAssignmentActiveFrom,
        })),
      ];
      await transaction.teamMembership.createMany({ data: membershipRows });

      const baselineRows: Prisma.PersonalBaselineCreateManyInput[] = elderIds.map((elderId, index) => {
        const common = {
          id: fixedId('8e000000', index + 1),
          ...mainFacilityFilter,
          elderId,
          baselineKey: `ROUTINE_${String(index + 1).padStart(2, '0')}`,
          domain: ['ROUTINE', 'COMMUNICATION', 'MOBILITY', 'SOCIAL'][index % 4] as Prisma.PersonalBaselineCreateManyInput['domain'],
          value: `虚构基线偏好${String(index + 1).padStart(2, '0')}`,
          observedAt: new Date(seedStartedAt - (index + 2) * DAY),
          validFrom: new Date(seedStartedAt - (index + 2) * DAY),
        };
        if (index === 0) {
          return { ...common, sourceKind: 'ELDER_STATED', sourceUserId: ids.users.elder };
        }
        if (index <= 5) {
          return {
            ...common,
            sourceKind: 'STAFF_CONFIRMED',
            sourceUserId: ids.users.supervisor,
            confirmedByStaffProfileId: fixedId('92000000', 1),
          };
        }
        return {
          ...common,
          sourceKind: 'INFERRED',
          inferenceMethod: 'fixture_pattern_v1',
          confidence: 0.62 + (index % 3) * 0.1,
        };
      });
      await transaction.personalBaseline.createMany({ data: baselineRows });

      const familySharingConsents: Prisma.ConsentRecordCreateManyInput[] = elderIds.map((elderId, index) => ({
        id: fixedId('8f000000', index + 1),
        ...mainFacilityFilter,
        elderId,
        purpose: 'FAMILY_SHARING',
        decision: 'GRANTED',
        authority: index === 2 ? 'AUTHORIZED_REPRESENTATIVE' : 'ELDER',
        consentVersion: 1,
        effectiveAt: new Date(seedStartedAt - 30 * DAY),
        recordedByUserId: ids.users.supervisor,
      }));
      const historyEffectiveAt = new Date(seedStartedAt - 20 * DAY);
      const historySupersededAt = new Date(seedStartedAt - 10 * DAY);
      const consentHistory: Prisma.ConsentRecordCreateManyInput[] = [
        {
          id: fixedId('8f000000', 13),
          ...mainFacilityFilter,
          elderId: elderIds[0] ?? '',
          purpose: 'EMOTION_TREND',
          decision: 'GRANTED',
          authority: 'ELDER',
          consentVersion: 1,
          effectiveAt: historyEffectiveAt,
          supersededAt: historySupersededAt,
          recordedByUserId: ids.users.supervisor,
        },
        {
          id: fixedId('8f000000', 14),
          ...mainFacilityFilter,
          elderId: elderIds[0] ?? '',
          purpose: 'EMOTION_TREND',
          decision: 'WITHDRAWN',
          authority: 'ELDER',
          consentVersion: 2,
          effectiveAt: historySupersededAt,
          reasonCode: 'ELDER_WITHDRAWAL',
          recordedByUserId: ids.users.supervisor,
        },
        {
          id: fixedId('8f000000', 15),
          ...mainFacilityFilter,
          elderId: elderIds[1] ?? '',
          purpose: 'ELDER_LOCATION',
          decision: 'GRANTED',
          authority: 'ELDER',
          consentVersion: 1,
          effectiveAt: historyEffectiveAt,
          supersededAt: historySupersededAt,
          recordedByUserId: ids.users.supervisor,
        },
        {
          id: fixedId('8f000000', 16),
          ...mainFacilityFilter,
          elderId: elderIds[1] ?? '',
          purpose: 'ELDER_LOCATION',
          decision: 'WITHDRAWN',
          authority: 'ELDER',
          consentVersion: 2,
          effectiveAt: historySupersededAt,
          reasonCode: 'ELDER_WITHDRAWAL',
          recordedByUserId: ids.users.supervisor,
        },
        {
          id: fixedId('8f000000', 17),
          ...mainFacilityFilter,
          elderId: elderIds[2] ?? '',
          purpose: 'CAREGIVER_SHIFT_LOCATION',
          decision: 'DECLINED',
          authority: 'LEGAL_BASIS',
          consentVersion: 1,
          effectiveAt: historySupersededAt,
          reasonCode: 'NO_ACTIVE_BASIS',
          recordedByUserId: ids.users.supervisor,
        },
      ];
      await transaction.consentRecord.createMany({ data: [...familySharingConsents, ...consentHistory] });

      await transaction.sharingPreference.createMany({
        data: [
          { id: fixedId('91000000', 1), ...mainFacilityFilter, elderId: elderIds[0] ?? '', familyRelationshipId: fixedId('8a000000', 1), consentRecordId: fixedId('8f000000', 1), field: 'PREFERRED_NAME', allowed: true, validFrom: new Date(seedStartedAt - 30 * DAY) },
          { id: fixedId('91000000', 2), ...mainFacilityFilter, elderId: elderIds[0] ?? '', familyRelationshipId: fixedId('8a000000', 1), consentRecordId: fixedId('8f000000', 1), field: 'CURRENT_RESIDENCE', allowed: true, validFrom: new Date(seedStartedAt - 30 * DAY) },
          { id: fixedId('91000000', 3), ...mainFacilityFilter, elderId: elderIds[0] ?? '', familyRelationshipId: fixedId('8a000000', 1), field: 'PERSONAL_BASELINE_SUMMARY', allowed: false, validFrom: new Date(seedStartedAt - 30 * DAY) },
        ],
      });

      await transaction.shift.createMany({
        data: shiftFixtures.map((shift) => ({
          id: shift.id,
          ...mainFacilityFilter,
          teamId: shift.teamId,
          code: shift.code,
          name: shift.name,
          startsAt: shift.startsAt,
          endsAt: shift.endsAt,
          status: shift.status,
        })),
      });

      const shiftAssignmentRows: Prisma.ShiftAssignmentCreateManyInput[] = shiftFixtures.map((shift, index) => ({
        id: fixedId('96000000', index + 1),
        ...mainFacilityFilter,
        shiftId: shift.id,
        staffProfileId: caregiverStaffIds[shift.caregiverIndex] ?? '',
        status: shift.assignmentStatus,
        assignedAt: shift.assignedAt,
      }));
      await transaction.shiftAssignment.createMany({ data: shiftAssignmentRows });

      const scopeRows: Prisma.ShiftAssignmentScopeCreateManyInput[] = shiftFixtures.map((shift, index) => {
        const assignmentId = fixedId('96000000', index + 1);
        const floorId = floorIds[shift.floorIndex] ?? '';
        const zoneId = zoneIds[shift.zoneIndex] ?? '';
        return index % 3 === 0
          ? { id: fixedId('97000000', index + 1), ...mainFacilityFilter, shiftAssignmentId: assignmentId, kind: 'ZONE', floorId, zoneId }
          : { id: fixedId('97000000', index + 1), ...mainFacilityFilter, shiftAssignmentId: assignmentId, kind: 'FLOOR', floorId };
      });
      await transaction.shiftAssignmentScope.createMany({ data: scopeRows });

      const elderCareRows: Prisma.ElderCareAssignmentCreateManyInput[] = shiftFixtures.map((shift, index) => ({
        id: fixedId('98000000', index + 1),
        ...mainFacilityFilter,
        shiftAssignmentId: fixedId('96000000', index + 1),
        elderId: elderIds[shift.elderIndex] ?? '',
        role: index % 4 === 0 ? 'SUPPORT' : 'PRIMARY',
      }));
      await transaction.elderCareAssignment.createMany({ data: elderCareRows });

      const caregiverRoleIds = new Map(
        caregiverUserIds.map((userId) => [
          userId,
          assignments.find((assignment) => assignment.userId === userId && assignment.role === 'CAREGIVER')?.id ?? '',
        ]),
      );
      for (const [index, shift] of shiftFixtures.entries()) {
        const assignmentId = fixedId('96000000', index + 1);
        const caregiverUserId = caregiverUserIds[shift.caregiverIndex] ?? '';
        const userRoleId = caregiverRoleIds.get(caregiverUserId) ?? '';
        const activeScopeId = index === 0 ? fixedId('70000000', 4) : fixedId('9a000000', index * 3 + 1);
        const authorizationWindow = index === 0
          ? activeShiftAuthorizationWindow
          : { validFrom: shift.startsAt, validUntil: shift.authorizationEndsAt };
        const authorizationScopes: Prisma.DataScopeCreateManyInput[] = [
          {
            id: activeScopeId,
            userRoleId,
            ...mainFacilityFilter,
            kind: 'ACTIVE_SHIFT',
            scopeKey: `active-shift:${assignmentId}`,
            validFrom: authorizationWindow.validFrom,
            validUntil: authorizationWindow.validUntil,
          },
          {
            id: fixedId('9a000000', index * 3 + 3),
            userRoleId,
            ...mainFacilityFilter,
            kind: 'ASSIGNED_ELDER',
            scopeKey: `shift-elder:${assignmentId}:${elderIds[shift.elderIndex] ?? ''}`,
            resourceType: 'ELDER',
            resourceId: elderIds[shift.elderIndex],
            validFrom: authorizationWindow.validFrom,
            validUntil: authorizationWindow.validUntil,
          },
        ];
        if (index % 3 !== 0) {
          authorizationScopes.push({
            id: fixedId('9a000000', index * 3 + 2),
            userRoleId,
            ...mainFacilityFilter,
            kind: 'FLOOR',
            scopeKey: `shift-floor:${assignmentId}:${floorIds[shift.floorIndex] ?? ''}`,
            resourceType: 'FLOOR',
            resourceId: floorIds[shift.floorIndex],
            validFrom: authorizationWindow.validFrom,
            validUntil: authorizationWindow.validUntil,
          });
        }
        await transaction.dataScope.createMany({ data: authorizationScopes });
      }

      const timelineRows: Prisma.ElderTimelineEntryCreateManyInput[] = elderIds.map((elderId, index) => ({
        id: fixedId('99000000', index + 1),
        ...mainFacilityFilter,
        elderId,
        eventType: 'ADMISSION_CONFIRMED',
        sourceResourceType: 'ELDER_STAY',
        sourceResourceId: fixedId('89000000', index + 1),
        visibility: index % 3 === 0 ? 'FAMILY_ELIGIBLE' : index % 3 === 1 ? 'ELDER_VISIBLE' : 'INTERNAL',
        safeSummaryCode: 'ELDER_ADMITTED',
        safeMetadata: { admissionNumber: `QL-A${String(index + 1).padStart(3, '0')}` },
        actorUserId: ids.users.supervisor,
        correlationId: `seed-m02-elder-${String(index + 1).padStart(2, '0')}`,
        occurredAt: new Date(seedStartedAt - (60 + index) * DAY),
      }));
      await transaction.elderTimelineEntry.createMany({ data: timelineRows });

      await transaction.auditEvent.createMany({
        data: [
          {
            id: ids.auditM01,
            organizationId: ids.organizations.platform,
            actorUserId: ids.users.platformAdmin,
            actorType: 'USER',
            action: 'SYSTEM.M01_SEED_APPLIED',
            outcome: 'SUCCESS',
            resourceType: 'milestone',
            resourceId: 'M01',
            correlationId: 'seed-m01-auth-rbac',
            safeMetadata: { fictionalDemoData: true, schemaVersion: '1.1' },
          },
          {
            id: ids.auditM02,
            organizationId: ids.organizations.qinglan,
            facilityId: ids.facilities.qinglanMain,
            actorType: 'SYSTEM',
            action: 'SYSTEM.M02_SEED_APPLIED',
            outcome: 'SUCCESS',
            resourceType: 'milestone',
            resourceId: 'M02',
            correlationId: 'seed-m02-elder-management',
            safeMetadata: { fictionalDemoData: true, schemaVersion: '1.2', counts: M02_SEED_EXPECTATIONS },
          },
        ],
        skipDuplicates: true,
      });

      await transaction.systemMetadata.upsert({
        where: { key: 'foundation.seed' },
        create: {
          key: 'foundation.seed',
          value: { schemaVersion: '1.2', milestone: 'M02', containsBusinessFixtures: true, fictionalDemoData: true },
        },
        update: {
          value: { schemaVersion: '1.2', milestone: 'M02', containsBusinessFixtures: true, fictionalDemoData: true },
        },
      });
    }, { maxWait: 10_000, timeout: 120_000 });
  } finally {
    await prisma.$disconnect();
  }
}

void seed().catch(() => {
  console.error('Database seed failed. Check the database service logs for safe diagnostics.');
  process.exitCode = 1;
});

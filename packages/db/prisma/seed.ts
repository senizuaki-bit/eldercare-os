import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

import {
  M01_PERMISSIONS,
  M02_PERMISSIONS,
  M03_PERMISSIONS,
  M04_PERMISSIONS,
  ROLE_CODES,
  type M01Permission,
  type M02Permission,
  type M03Permission,
  type M04Permission,
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
  auditM03: '90000000-0000-4000-8000-000000000003',
  auditM04: '90000000-0000-4000-8000-000000000004',
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

type SeedPermission = M01Permission | M02Permission | M03Permission | M04Permission;

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
  [M03_PERMISSIONS.VOICE_SUBMISSION_CREATE, '创建语音提交'],
  [M03_PERMISSIONS.VOICE_SUBMISSION_READ, '查看授权语音提交'],
  [M03_PERMISSIONS.TRANSCRIPT_READ, '查看授权转写'],
  [M03_PERMISSIONS.AI_ANALYSIS_READ, '查看 AI 分析草稿'],
  [M03_PERMISSIONS.NEED_CREATE, '创建需求'],
  [M03_PERMISSIONS.NEED_READ, '查看需求'],
  [M03_PERMISSIONS.NEED_REVIEW, '复核需求'],
  [M03_PERMISSIONS.WORK_ORDER_CREATE, '创建工作单'],
  [M03_PERMISSIONS.WORK_ORDER_READ, '查看工作单'],
  [M03_PERMISSIONS.WORK_ORDER_ASSIGN, '指派工作单'],
  [M03_PERMISSIONS.WORK_ORDER_TRANSITION, '流转工作单'],
  [M03_PERMISSIONS.WORK_ORDER_VERIFY, '核验工作单'],
  [M03_PERMISSIONS.WORK_ORDER_CLOSE, '关闭工作单'],
  [M03_PERMISSIONS.FAMILY_SUMMARY_READ, '查看家属安全摘要'],
  [M03_PERMISSIONS.FAMILY_SUMMARY_PUBLISH, '发布家属安全摘要'],
  [M03_PERMISSIONS.RATING_CREATE, '创建服务评价'],
  [M03_PERMISSIONS.RATING_READ, '查看服务评价'],
  [M04_PERMISSIONS.EMERGENCY_SIGNAL_CREATE, '创建紧急信号'],
  [M04_PERMISSIONS.EMERGENCY_READ, '查看授权紧急事件'],
  [M04_PERMISSIONS.EMERGENCY_ASSIGN, '指派紧急响应人员'],
  [M04_PERMISSIONS.EMERGENCY_ACKNOWLEDGE, '确认紧急事件'],
  [M04_PERMISSIONS.EMERGENCY_RESPOND, '记录紧急响应进展'],
  [M04_PERMISSIONS.EMERGENCY_RESOLVE, '完成人工紧急处置'],
  [M04_PERMISSIONS.EMERGENCY_REVIEW, '复盘紧急事件'],
  [M04_PERMISSIONS.EMERGENCY_ESCALATE, '人工升级紧急事件'],
  [M04_PERMISSIONS.EMERGENCY_FAMILY_SUMMARY_READ, '查看家属可见紧急摘要'],
  [M04_PERMISSIONS.EMERGENCY_NOTIFICATION_PREFERENCE_MANAGE, '管理紧急通知偏好'],
  [M04_PERMISSIONS.EMERGENCY_POLICY_READ, '查看紧急升级策略'],
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
    ...Object.values(M03_PERMISSIONS),
    ...Object.values(M04_PERMISSIONS),
  ],
  CAREGIVER: [
    ...selfSessionPermissions,
    M01_PERMISSIONS.FACILITY_READ,
    M02_PERMISSIONS.ELDER_READ_BASIC,
    M02_PERMISSIONS.ELDER_TIMELINE_READ,
    M03_PERMISSIONS.VOICE_SUBMISSION_CREATE,
    M03_PERMISSIONS.VOICE_SUBMISSION_READ,
    M03_PERMISSIONS.NEED_READ,
    M03_PERMISSIONS.WORK_ORDER_READ,
    M03_PERMISSIONS.WORK_ORDER_TRANSITION,
    M04_PERMISSIONS.EMERGENCY_READ,
    M04_PERMISSIONS.EMERGENCY_ACKNOWLEDGE,
    M04_PERMISSIONS.EMERGENCY_RESPOND,
    M04_PERMISSIONS.EMERGENCY_RESOLVE,
  ],
  DEVICE_MANAGER: [
    ...selfSessionPermissions,
    M01_PERMISSIONS.FACILITY_READ,
    M04_PERMISSIONS.EMERGENCY_SIGNAL_CREATE,
    M04_PERMISSIONS.EMERGENCY_POLICY_READ,
  ],
  ELDER: [
    ...selfSessionPermissions,
    M01_PERMISSIONS.FACILITY_READ,
    M02_PERMISSIONS.ELDER_READ_BASIC,
    M02_PERMISSIONS.ELDER_READ_SENSITIVE,
    M02_PERMISSIONS.ELDER_TIMELINE_READ,
    M02_PERMISSIONS.CONSENT_MANAGE,
    M03_PERMISSIONS.VOICE_SUBMISSION_CREATE,
    M03_PERMISSIONS.VOICE_SUBMISSION_READ,
    M03_PERMISSIONS.NEED_CREATE,
    M03_PERMISSIONS.WORK_ORDER_READ,
    M03_PERMISSIONS.WORK_ORDER_VERIFY,
    M03_PERMISSIONS.RATING_CREATE,
    M04_PERMISSIONS.EMERGENCY_SIGNAL_CREATE,
    M04_PERMISSIONS.EMERGENCY_READ,
  ],
  FAMILY: [
    ...selfSessionPermissions,
    M01_PERMISSIONS.FACILITY_READ,
    M02_PERMISSIONS.ELDER_READ_BASIC,
    M02_PERMISSIONS.ELDER_TIMELINE_READ,
    M03_PERMISSIONS.FAMILY_SUMMARY_READ,
    M03_PERMISSIONS.RATING_CREATE,
    M04_PERMISSIONS.EMERGENCY_FAMILY_SUMMARY_READ,
    M04_PERMISSIONS.EMERGENCY_NOTIFICATION_PREFERENCE_MANAGE,
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

const M03_SEED_EXPECTATIONS = {
  voiceSubmissions: 1,
  transcripts: 1,
  aiAnalyses: 1,
  needs: 3,
  needLinks: 1,
  workOrders: 2,
  assignments: 2,
  transitions: 9,
  arrivals: 1,
  completions: 1,
  familySummaries: 1,
  ratings: 1,
} as const;

const M03_AUDIT_SAFE_COUNTS = {
  needs: M03_SEED_EXPECTATIONS.needs,
  workOrders: M03_SEED_EXPECTATIONS.workOrders,
  assignments: M03_SEED_EXPECTATIONS.assignments,
  transitions: M03_SEED_EXPECTATIONS.transitions,
} as const;

const M04_SEED_EXPECTATIONS = {
  sourceBindings: 1,
  escalationPolicies: 1,
  escalationSteps: 3,
  events: 4,
  signals: 4,
  relatedEvents: 1,
  acknowledgements: 2,
  responders: 2,
  milestones: 4,
  resolutions: 1,
  reviews: 1,
  familySummaries: 2,
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
      await transaction.$executeRawUnsafe("SET LOCAL eldercare.seed_mode = 'on'");
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
      await transaction.emergencyNotificationDelivery.deleteMany({ where: mainFacilityFilter });
      await transaction.emergencyFamilySummary.deleteMany({ where: mainFacilityFilter });
      await transaction.emergencyCommandReceipt.deleteMany({ where: mainFacilityFilter });
      await transaction.familyEmergencyNotificationPreference.deleteMany({
        where: mainFacilityFilter,
      });
      await transaction.emergencyReview.deleteMany({ where: mainFacilityFilter });
      await transaction.emergencyResolution.deleteMany({ where: mainFacilityFilter });
      await transaction.emergencyEscalation.deleteMany({ where: mainFacilityFilter });
      await transaction.emergencyResponseMilestone.deleteMany({ where: mainFacilityFilter });
      await transaction.emergencyAcknowledgement.deleteMany({ where: mainFacilityFilter });
      await transaction.emergencyResponderAssignment.deleteMany({
        where: mainFacilityFilter,
      });
      await transaction.emergencyResponder.deleteMany({ where: mainFacilityFilter });
      await transaction.emergencyRelatedEvent.deleteMany({ where: mainFacilityFilter });
      await transaction.emergencyTransition.deleteMany({ where: mainFacilityFilter });
      await transaction.emergencyLocationSnapshot.deleteMany({ where: mainFacilityFilter });
      await transaction.emergencySignal.deleteMany({ where: mainFacilityFilter });
      await transaction.emergencyEvent.deleteMany({ where: mainFacilityFilter });
      await transaction.escalationStep.deleteMany({ where: mainFacilityFilter });
      await transaction.escalationPolicy.deleteMany({ where: mainFacilityFilter });
      await transaction.emergencySourceBinding.deleteMany({ where: mainFacilityFilter });
      await transaction.rating.deleteMany({ where: mainFacilityFilter });
      await transaction.familySummary.deleteMany({ where: mainFacilityFilter });
      await transaction.serviceCompletion.deleteMany({ where: mainFacilityFilter });
      await transaction.workOrderArrival.deleteMany({ where: mainFacilityFilter });
      await transaction.workOrderTransition.deleteMany({ where: mainFacilityFilter });
      await transaction.workOrderAssignment.deleteMany({ where: mainFacilityFilter });
      await transaction.aIAnalysis.deleteMany({
        where: {
          ...mainFacilityFilter,
          transcript: { voiceSubmission: { purpose: 'WORK_ORDER_COMPLETION' } },
        },
      });
      await transaction.transcript.deleteMany({
        where: {
          ...mainFacilityFilter,
          voiceSubmission: { purpose: 'WORK_ORDER_COMPLETION' },
        },
      });
      await transaction.voiceSubmission.deleteMany({
        where: { ...mainFacilityFilter, purpose: 'WORK_ORDER_COMPLETION' },
      });
      await transaction.workOrder.deleteMany({ where: mainFacilityFilter });
      await transaction.needLink.deleteMany({ where: mainFacilityFilter });
      await transaction.need.deleteMany({ where: mainFacilityFilter });
      await transaction.aIAnalysis.deleteMany({ where: mainFacilityFilter });
      await transaction.transcript.deleteMany({ where: mainFacilityFilter });
      await transaction.voiceSubmission.deleteMany({ where: mainFacilityFilter });
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
        {
          id: fixedId('8f000000', 18),
          ...mainFacilityFilter,
          elderId: elderIds[0] ?? '',
          purpose: 'VOICE_CAPTURE',
          decision: 'GRANTED',
          authority: 'ELDER',
          consentVersion: 1,
          effectiveAt: new Date(seedStartedAt - 30 * DAY),
          recordedByUserId: ids.users.elder,
        },
        {
          id: fixedId('8f000000', 19),
          ...mainFacilityFilter,
          elderId: elderIds[0] ?? '',
          purpose: 'TRANSCRIPTION_AI_ANALYSIS',
          decision: 'GRANTED',
          authority: 'ELDER',
          consentVersion: 1,
          effectiveAt: new Date(seedStartedAt - 30 * DAY),
          recordedByUserId: ids.users.elder,
        },
      ];
      await transaction.consentRecord.createMany({ data: [...familySharingConsents, ...consentHistory] });

      await transaction.sharingPreference.createMany({
        data: [
          { id: fixedId('91000000', 1), ...mainFacilityFilter, elderId: elderIds[0] ?? '', familyRelationshipId: fixedId('8a000000', 1), consentRecordId: fixedId('8f000000', 1), field: 'PREFERRED_NAME', allowed: true, validFrom: new Date(seedStartedAt - 30 * DAY) },
          { id: fixedId('91000000', 2), ...mainFacilityFilter, elderId: elderIds[0] ?? '', familyRelationshipId: fixedId('8a000000', 1), consentRecordId: fixedId('8f000000', 1), field: 'CURRENT_RESIDENCE', allowed: true, validFrom: new Date(seedStartedAt - 30 * DAY) },
          { id: fixedId('91000000', 3), ...mainFacilityFilter, elderId: elderIds[0] ?? '', familyRelationshipId: fixedId('8a000000', 1), field: 'PERSONAL_BASELINE_SUMMARY', allowed: false, validFrom: new Date(seedStartedAt - 30 * DAY) },
          { id: fixedId('91000000', 4), ...mainFacilityFilter, elderId: elderIds[0] ?? '', familyRelationshipId: fixedId('8a000000', 1), consentRecordId: fixedId('8f000000', 1), field: 'TIMELINE_SUMMARY', allowed: true, validFrom: new Date(seedStartedAt - 30 * DAY) },
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

      const canonicalRequestedAt = new Date(seedStartedAt - 30 * 60 * 1000);
      const canonicalAcceptedAt = new Date(seedStartedAt - 20 * 60 * 1000);
      const historicalCreatedAt = new Date(seedStartedAt - 3 * DAY);
      const historicalAssignedAt = new Date(historicalCreatedAt.getTime() + 10 * 60 * 1000);
      const historicalAcceptedAt = new Date(historicalCreatedAt.getTime() + 20 * 60 * 1000);
      const historicalArrivedAt = new Date(historicalCreatedAt.getTime() + 30 * 60 * 1000);
      const historicalStartedAt = new Date(historicalCreatedAt.getTime() + 40 * 60 * 1000);
      const historicalCompletedAt = new Date(historicalCreatedAt.getTime() + HOUR);
      const historicalVerifiedAt = new Date(historicalCreatedAt.getTime() + 2 * HOUR);
      const elderId = elderIds[0] ?? '';
      const canonicalCorrelationId = 'seed-m03-hot-water-dizziness';
      const historicalCorrelationId = 'seed-m03-family-summary';

      await transaction.voiceSubmission.create({
        data: {
          id: fixedId('a3000000', 1),
          ...mainFacilityFilter,
          elderId,
          submittedByUserId: ids.users.elder,
          purpose: 'ELDER_REQUEST',
          status: 'COMPLETED',
          bucket: 'eldercare-private',
          objectKey: `voice/sealed/${ids.organizations.qinglan}/${ids.facilities.qinglanMain}/${elderId}/${fixedId('a3000000', 1)}/a3000000-0000-4000-8000-000000000099`,
          mimeType: 'audio/webm',
          declaredSizeBytes: 4096,
          actualSizeBytes: 4096,
          checksumSha256: 'a'.repeat(64),
          fixtureKey: 'HOT_WATER_DIZZINESS_V1',
          uploadedAt: canonicalRequestedAt,
          completedAt: new Date(canonicalRequestedAt.getTime() + 4_000),
          retentionUntil: new Date(seedStartedAt + 30 * DAY),
          idempotencyKey: 'seed-m03-voice-hot-water-dizziness',
          correlationId: canonicalCorrelationId,
          createdAt: canonicalRequestedAt,
        },
      });

      await transaction.transcript.create({
        data: {
          id: fixedId('a3100000', 1),
          ...mainFacilityFilter,
          elderId,
          voiceSubmissionId: fixedId('a3000000', 1),
          status: 'COMPLETED',
          text: '我想喝热水，今天有点头晕。',
          confidence: 0.98,
          durationMs: 3200,
          provider: 'deterministic-fake',
          model: 'fixture-transcriber-v1',
          providerVersion: '1.0.0',
          retentionUntil: new Date(seedStartedAt + 30 * DAY),
          correlationId: canonicalCorrelationId,
          createdAt: canonicalRequestedAt,
          completedAt: new Date(canonicalRequestedAt.getTime() + 5_000),
        },
      });

      await transaction.aIAnalysis.create({
        data: {
          id: fixedId('a3200000', 1),
          ...mainFacilityFilter,
          elderId,
          transcriptId: fixedId('a3100000', 1),
          status: 'COMPLETED',
          output: {
            summary: '老人希望喝热水，并表示今天有点头晕。',
            categories: ['DAILY_LIVING', 'HEALTH_CONCERN'],
            urgencySuggestion: 'PRIORITY',
            reportedConcerns: ['头晕'],
            safetyFlags: ['DIZZINESS_REQUIRES_REVIEW'],
            emotionObservation: null,
            followUpQuestions: ['头晕是否突然出现，是否伴随胸痛、呼吸困难或跌倒？'],
            requiresHumanReview: true,
            subIntents: [
              { category: 'DAILY_LIVING', summary: '提供适温热水。', urgencySuggestion: 'ROUTINE' },
              { category: 'HEALTH_CONCERN', summary: '人工查看老人今天报告的头晕。', urgencySuggestion: 'PRIORITY' },
            ],
          },
          confidence: 0.96,
          evidence: ['老人原话包含“喝热水”与“头晕”两个明确意图。'],
          provider: 'deterministic-fake',
          model: 'fixture-needs-v1',
          promptVersion: 'need-analysis-v1',
          schemaVersion: 'need-analysis-output-v1',
          retentionUntil: new Date(seedStartedAt + 30 * DAY),
          correlationId: canonicalCorrelationId,
          createdAt: canonicalRequestedAt,
          completedAt: new Date(canonicalRequestedAt.getTime() + 6_000),
        },
      });

      await transaction.need.createMany({
        data: [
          {
            id: fixedId('a3300000', 1),
            ...mainFacilityFilter,
            elderId,
            voiceSubmissionId: fixedId('a3000000', 1),
            aiAnalysisId: fixedId('a3200000', 1),
            source: 'VOICE',
            summary: '提供适温热水。',
            category: 'DAILY_LIVING',
            urgencySuggestion: 'ROUTINE',
            priority: 'ROUTINE',
            requiresHumanReview: false,
            safetyRuleCodes: [],
            status: 'CONFIRMED',
            reviewedByUserId: ids.users.supervisor,
            reviewedAt: new Date(canonicalRequestedAt.getTime() + 8_000),
            reviewReasonCode: 'SAFE_DAILY_LIVING_REQUEST',
            idempotencyKey: 'seed-m03-need-hot-water',
            correlationId: canonicalCorrelationId,
            createdAt: canonicalRequestedAt,
          },
          {
            id: fixedId('a3300000', 2),
            ...mainFacilityFilter,
            elderId,
            voiceSubmissionId: fixedId('a3000000', 1),
            aiAnalysisId: fixedId('a3200000', 1),
            source: 'VOICE',
            summary: '人工查看老人今天报告的头晕。',
            category: 'HEALTH_CONCERN',
            urgencySuggestion: 'PRIORITY',
            priority: 'PRIORITY',
            requiresHumanReview: true,
            safetyRuleCodes: ['HEALTH_CONCERN_REQUIRES_HUMAN_REVIEW'],
            status: 'REVIEW_REQUIRED',
            idempotencyKey: 'seed-m03-need-dizziness',
            correlationId: canonicalCorrelationId,
            createdAt: canonicalRequestedAt,
          },
          {
            id: fixedId('a3300000', 3),
            ...mainFacilityFilter,
            elderId,
            source: 'MANUAL',
            summary: '送达房间饮水并完成服务确认。',
            category: 'DAILY_LIVING',
            urgencySuggestion: 'ROUTINE',
            priority: 'ROUTINE',
            requiresHumanReview: false,
            safetyRuleCodes: [],
            status: 'FULFILLED',
            reviewedByUserId: ids.users.supervisor,
            reviewedAt: historicalAssignedAt,
            reviewReasonCode: 'MANUAL_DEMO_REQUEST',
            idempotencyKey: 'seed-m03-need-completed-water',
            correlationId: historicalCorrelationId,
            createdAt: historicalCreatedAt,
          },
        ],
      });

      await transaction.needLink.create({
        data: {
          id: fixedId('a3400000', 1),
          ...mainFacilityFilter,
          sourceNeedId: fixedId('a3300000', 1),
          targetNeedId: fixedId('a3300000', 2),
          kind: 'SPLIT_SIBLING',
          correlationId: canonicalCorrelationId,
          createdAt: canonicalRequestedAt,
        },
      });

      await transaction.workOrder.createMany({
        data: [
          {
            id: fixedId('a3500000', 1),
            ...mainFacilityFilter,
            elderId,
            primaryNeedId: fixedId('a3300000', 1),
            code: 'M03-001',
            title: '提供适温热水',
            summary: '老人请求一杯适温热水。',
            priority: 'ROUTINE',
            status: 'ACCEPTED',
            dueAt: new Date(seedStartedAt + HOUR),
            acceptedAt: canonicalAcceptedAt,
            createdByUserId: ids.users.supervisor,
            idempotencyKey: 'seed-m03-work-order-active',
            correlationId: canonicalCorrelationId,
            version: 3,
            createdAt: canonicalRequestedAt,
          },
          {
            id: fixedId('a3500000', 2),
            ...mainFacilityFilter,
            elderId,
            primaryNeedId: fixedId('a3300000', 3),
            code: 'M03-002',
            title: '历史送水服务',
            summary: '已完成送水并由老人确认。',
            priority: 'ROUTINE',
            status: 'VERIFIED',
            dueAt: new Date(historicalCreatedAt.getTime() + 2 * HOUR),
            acceptedAt: historicalAcceptedAt,
            arrivedAt: historicalArrivedAt,
            startedAt: historicalStartedAt,
            completedAt: historicalCompletedAt,
            verifiedAt: historicalVerifiedAt,
            createdByUserId: ids.users.supervisor,
            idempotencyKey: 'seed-m03-work-order-completed',
            correlationId: historicalCorrelationId,
            version: 7,
            createdAt: historicalCreatedAt,
          },
        ],
      });

      await transaction.workOrderAssignment.createMany({
        data: [
          {
            id: fixedId('a3600000', 1),
            ...mainFacilityFilter,
            workOrderId: fixedId('a3500000', 1),
            targetTeamId: teamIds[0],
            assigneeStaffProfileId: caregiverStaffIds[0],
            shiftAssignmentId: fixedId('96000000', 1),
            status: 'CLAIMED',
            assignedByUserId: ids.users.supervisor,
            assignedAt: new Date(canonicalRequestedAt.getTime() + 10_000),
            claimedAt: canonicalAcceptedAt,
            reasonCode: 'CURRENT_SHIFT_ASSIGNEE',
          },
          {
            id: fixedId('a3600000', 2),
            ...mainFacilityFilter,
            workOrderId: fixedId('a3500000', 2),
            targetTeamId: teamIds[0],
            assigneeStaffProfileId: caregiverStaffIds[0],
            status: 'CLAIMED',
            assignedByUserId: ids.users.supervisor,
            assignedAt: historicalAssignedAt,
            claimedAt: historicalAcceptedAt,
            reasonCode: 'HISTORICAL_DEMO_ASSIGNEE',
          },
        ],
      });

      await transaction.workOrderTransition.createMany({
        data: [
          { id: fixedId('a3700000', 1), ...mainFacilityFilter, workOrderId: fixedId('a3500000', 1), fromStatus: null, toStatus: 'NEW', fromVersion: 0, toVersion: 1, actorUserId: ids.users.supervisor, reasonCode: 'NEED_CONFIRMED', correlationId: canonicalCorrelationId, occurredAt: canonicalRequestedAt },
          { id: fixedId('a3700000', 2), ...mainFacilityFilter, workOrderId: fixedId('a3500000', 1), fromStatus: 'NEW', toStatus: 'ASSIGNED', fromVersion: 1, toVersion: 2, actorUserId: ids.users.supervisor, reasonCode: 'CURRENT_SHIFT_ASSIGNEE', correlationId: canonicalCorrelationId, occurredAt: new Date(canonicalRequestedAt.getTime() + 10_000) },
          { id: fixedId('a3700000', 3), ...mainFacilityFilter, workOrderId: fixedId('a3500000', 1), fromStatus: 'ASSIGNED', toStatus: 'ACCEPTED', fromVersion: 2, toVersion: 3, actorUserId: ids.users.caregiver, reasonCode: 'CAREGIVER_ACCEPTED', correlationId: canonicalCorrelationId, occurredAt: canonicalAcceptedAt },
          { id: fixedId('a3700000', 4), ...mainFacilityFilter, workOrderId: fixedId('a3500000', 2), fromStatus: null, toStatus: 'NEW', fromVersion: 0, toVersion: 1, actorUserId: ids.users.supervisor, reasonCode: 'MANUAL_NEED_CONFIRMED', correlationId: historicalCorrelationId, occurredAt: historicalCreatedAt },
          { id: fixedId('a3700000', 5), ...mainFacilityFilter, workOrderId: fixedId('a3500000', 2), fromStatus: 'NEW', toStatus: 'ASSIGNED', fromVersion: 1, toVersion: 2, actorUserId: ids.users.supervisor, reasonCode: 'DEMO_ASSIGNEE', correlationId: historicalCorrelationId, occurredAt: historicalAssignedAt },
          { id: fixedId('a3700000', 6), ...mainFacilityFilter, workOrderId: fixedId('a3500000', 2), fromStatus: 'ASSIGNED', toStatus: 'ACCEPTED', fromVersion: 2, toVersion: 3, actorUserId: ids.users.caregiver, reasonCode: 'CAREGIVER_ACCEPTED', correlationId: historicalCorrelationId, occurredAt: historicalAcceptedAt },
          { id: fixedId('a3700000', 7), ...mainFacilityFilter, workOrderId: fixedId('a3500000', 2), fromStatus: 'ACCEPTED', toStatus: 'IN_PROGRESS', fromVersion: 4, toVersion: 5, actorUserId: ids.users.caregiver, reasonCode: 'SERVICE_STARTED', correlationId: historicalCorrelationId, occurredAt: historicalStartedAt },
          { id: fixedId('a3700000', 8), ...mainFacilityFilter, workOrderId: fixedId('a3500000', 2), fromStatus: 'IN_PROGRESS', toStatus: 'COMPLETED', fromVersion: 5, toVersion: 6, actorUserId: ids.users.caregiver, reasonCode: 'SERVICE_COMPLETED', correlationId: historicalCorrelationId, occurredAt: historicalCompletedAt },
          { id: fixedId('a3700000', 9), ...mainFacilityFilter, workOrderId: fixedId('a3500000', 2), fromStatus: 'COMPLETED', toStatus: 'VERIFIED', fromVersion: 6, toVersion: 7, actorUserId: ids.users.elder, reasonCode: 'ELDER_VERIFIED', correlationId: historicalCorrelationId, occurredAt: historicalVerifiedAt },
        ],
      });

      await transaction.workOrderArrival.create({
        data: {
          id: fixedId('a3800000', 1),
          ...mainFacilityFilter,
          workOrderId: fixedId('a3500000', 2),
          actorUserId: ids.users.caregiver,
          fromVersion: 3,
          toVersion: 4,
          reasonCode: 'CAREGIVER_ARRIVED',
          arrivedAt: historicalArrivedAt,
          correlationId: historicalCorrelationId,
          createdAt: historicalArrivedAt,
        },
      });

      await transaction.serviceCompletion.create({
        data: {
          id: fixedId('a3900000', 1),
          ...mainFacilityFilter,
          elderId,
          workOrderId: fixedId('a3500000', 2),
          submittedByStaffProfileId: caregiverStaffIds[0] ?? '',
          noteSource: 'TEXT',
          noteText: '已将适温饮水送至房间，并当面确认服务完成。',
          confirmedAt: historicalCompletedAt,
          completionChecklist: {
            schemaVersion: 1,
            required: false,
            riskReasons: [],
            expectedCodes: [],
            confirmations: [],
          },
          checklistConfirmedAt: null,
          correlationId: historicalCorrelationId,
          createdAt: historicalCompletedAt,
        },
      });

      await transaction.familySummary.create({
        data: {
          id: fixedId('a3a00000', 1),
          ...mainFacilityFilter,
          elderId,
          workOrderId: fixedId('a3500000', 2),
          status: 'PUBLISHED',
          title: '饮水服务已完成',
          summary: '工作人员已完成饮水服务，老人已确认。',
          serviceCompletedAt: historicalCompletedAt,
          publishedAt: new Date(historicalVerifiedAt.getTime() + 30 * 60 * 1000),
          publishedByUserId: ids.users.supervisor,
          correlationId: historicalCorrelationId,
          createdAt: historicalCompletedAt,
        },
      });

      await transaction.rating.create({
        data: {
          id: fixedId('a3b00000', 1),
          ...mainFacilityFilter,
          elderId,
          workOrderId: fixedId('a3500000', 2),
          raterUserId: ids.users.elder,
          actorType: 'ELDER',
          score: 5,
          comment: '送得很及时，谢谢。',
          requiresFollowUp: false,
          idempotencyKey: 'seed-m03-rating-elder',
          correlationId: historicalCorrelationId,
          createdAt: new Date(historicalVerifiedAt.getTime() + HOUR),
        },
      });

      await transaction.elderTimelineEntry.createMany({
        data: [
          {
            id: fixedId('a3c00000', 1),
            ...mainFacilityFilter,
            elderId,
            eventType: 'WORK_ORDER_ACCEPTED',
            sourceResourceType: 'WORK_ORDER',
            sourceResourceId: fixedId('a3500000', 1),
            visibility: 'ELDER_VISIBLE',
            safeSummaryCode: 'SERVICE_REQUEST_ACCEPTED',
            safeMetadata: { workOrderCode: 'M03-001' },
            actorUserId: ids.users.caregiver,
            correlationId: canonicalCorrelationId,
            occurredAt: canonicalAcceptedAt,
          },
          {
            id: fixedId('a3c00000', 2),
            ...mainFacilityFilter,
            elderId,
            eventType: 'FAMILY_SUMMARY_PUBLISHED',
            sourceResourceType: 'FAMILY_SUMMARY',
            sourceResourceId: fixedId('a3a00000', 1),
            visibility: 'FAMILY_ELIGIBLE',
            safeSummaryCode: 'SERVICE_COMPLETED',
            safeMetadata: { workOrderCode: 'M03-002' },
            actorUserId: ids.users.supervisor,
            correlationId: historicalCorrelationId,
            occurredAt: new Date(historicalVerifiedAt.getTime() + 30 * 60 * 1000),
          },
        ],
      });

      const emergencyPolicyId = fixedId('b4100000', 1);
      const emergencyStepIds = {
        acknowledgement: fixedId('b4200000', 1),
        arrival: fixedId('b4200000', 2),
        resolution: fixedId('b4200000', 3),
      } as const;
      const emergencyEventIds = {
        overdueOpen: fixedId('b4300000', 1),
        responding: fixedId('b4300000', 2),
        reviewed: fixedId('b4300000', 3),
        relatedOpen: fixedId('b4300000', 4),
      } as const;
      const emergencySourceBindingId = fixedId('b4000000', 1);
      const emergencyOpenAt = new Date(seedStartedAt - 2 * 60 * 1000);
      const emergencyRelatedAt = new Date(emergencyOpenAt.getTime() + 20_000);
      const emergencyRespondingOpenedAt = new Date(seedStartedAt - 12 * 60 * 1000);
      const emergencyRespondingAcknowledgedAt = new Date(
        emergencyRespondingOpenedAt.getTime() + 45_000,
      );
      const emergencyRespondingAt = new Date(
        emergencyRespondingAcknowledgedAt.getTime() + 45_000,
      );
      const emergencyOnSiteAt = new Date(emergencyRespondingAt.getTime() + 4 * 60 * 1000);
      const emergencyReviewedOpenedAt = new Date(seedStartedAt - 2 * DAY);
      const emergencyReviewedAcknowledgedAt = new Date(
        emergencyReviewedOpenedAt.getTime() + 30_000,
      );
      const emergencyReviewedRespondingAt = new Date(
        emergencyReviewedAcknowledgedAt.getTime() + 60_000,
      );
      const emergencyReviewedOnSiteAt = new Date(
        emergencyReviewedRespondingAt.getTime() + 3 * 60 * 1000,
      );
      const emergencyResolvedAt = new Date(
        emergencyReviewedOnSiteAt.getTime() + 12 * 60 * 1000,
      );
      const emergencyReviewedAt = new Date(emergencyResolvedAt.getTime() + 2 * HOUR);

      await transaction.escalationPolicy.create({
        data: {
          id: emergencyPolicyId,
          ...mainFacilityFilter,
          code: 'M04-DEMO-NONCLINICAL',
          name: '非临床演示应急升级策略',
          version: 1,
          status: 'ACTIVE',
          effectiveAt: new Date(seedStartedAt - DAY),
        },
      });
      await transaction.escalationStep.createMany({
        data: [
          {
            id: emergencyStepIds.acknowledgement,
            ...mainFacilityFilter,
            escalationPolicyId: emergencyPolicyId,
            stage: 'ACKNOWLEDGEMENT',
            sequence: 1,
            thresholdSeconds: 60,
            reasonCode: 'ACKNOWLEDGEMENT_SLA_EXCEEDED',
            notifyRoleCodes: ['NURSING_SUPERVISOR'],
          },
          {
            id: emergencyStepIds.arrival,
            ...mainFacilityFilter,
            escalationPolicyId: emergencyPolicyId,
            stage: 'ARRIVAL',
            sequence: 1,
            thresholdSeconds: 300,
            reasonCode: 'ARRIVAL_SLA_EXCEEDED',
            notifyRoleCodes: ['NURSING_SUPERVISOR', 'FACILITY_DIRECTOR'],
          },
          {
            id: emergencyStepIds.resolution,
            ...mainFacilityFilter,
            escalationPolicyId: emergencyPolicyId,
            stage: 'RESOLUTION',
            sequence: 1,
            thresholdSeconds: 900,
            reasonCode: 'RESOLUTION_SLA_EXCEEDED',
            notifyRoleCodes: ['FACILITY_DIRECTOR'],
          },
        ],
      });
      await transaction.emergencySourceBinding.create({
        data: {
          id: emergencySourceBindingId,
          ...mainFacilityFilter,
          elderId,
          sourceKind: 'IOT_BUTTON',
          externalSourceId: 'call-device-qinglan-001',
          displayLabel: '1号楼201房间紧急呼叫按钮（虚构）',
          active: true,
        },
      });
      await transaction.emergencyEvent.createMany({
        data: [
          {
            id: emergencyEventIds.overdueOpen,
            ...mainFacilityFilter,
            elderId,
            sourceKind: 'IOT_BUTTON',
            reasonCode: 'IOT_EMERGENCY_BUTTON',
            status: 'OPEN',
            version: 1,
            escalationPolicyId: emergencyPolicyId,
            escalationPolicyVersion: 1,
            openedAt: emergencyOpenAt,
            currentDeadlineAt: new Date(emergencyOpenAt.getTime() + 60_000),
            correlationId: 'seed-m04-overdue-open',
            createdAt: emergencyOpenAt,
          },
          {
            id: emergencyEventIds.responding,
            ...mainFacilityFilter,
            elderId,
            sourceKind: 'STAFF_MANUAL',
            reasonCode: 'STAFF_REPORTED_EMERGENCY',
            status: 'RESPONDING',
            version: 4,
            escalationPolicyId: emergencyPolicyId,
            escalationPolicyVersion: 1,
            openedAt: emergencyRespondingOpenedAt,
            acknowledgedAt: emergencyRespondingAcknowledgedAt,
            respondingAt: emergencyRespondingAt,
            onSiteAt: emergencyOnSiteAt,
            currentDeadlineAt: new Date(emergencyRespondingAt.getTime() + 900_000),
            correlationId: 'seed-m04-responding',
            createdAt: emergencyRespondingOpenedAt,
          },
          {
            id: emergencyEventIds.reviewed,
            ...mainFacilityFilter,
            elderId,
            sourceKind: 'STAFF_MANUAL',
            reasonCode: 'STAFF_REPORTED_EMERGENCY',
            status: 'REVIEWED',
            version: 6,
            escalationPolicyId: emergencyPolicyId,
            escalationPolicyVersion: 1,
            openedAt: emergencyReviewedOpenedAt,
            acknowledgedAt: emergencyReviewedAcknowledgedAt,
            respondingAt: emergencyReviewedRespondingAt,
            onSiteAt: emergencyReviewedOnSiteAt,
            resolvedAt: emergencyResolvedAt,
            reviewedAt: emergencyReviewedAt,
            currentDeadlineAt: null,
            correlationId: 'seed-m04-reviewed',
            createdAt: emergencyReviewedOpenedAt,
          },
          {
            id: emergencyEventIds.relatedOpen,
            ...mainFacilityFilter,
            elderId,
            sourceKind: 'IOT_BUTTON',
            reasonCode: 'IOT_EMERGENCY_BUTTON',
            status: 'OPEN',
            version: 1,
            escalationPolicyId: emergencyPolicyId,
            escalationPolicyVersion: 1,
            openedAt: emergencyRelatedAt,
            currentDeadlineAt: new Date(emergencyRelatedAt.getTime() + 60_000),
            correlationId: 'seed-m04-related-open',
            createdAt: emergencyRelatedAt,
          },
        ],
      });
      await transaction.emergencySignal.createMany({
        data: [
          {
            id: fixedId('b4400000', 1),
            ...mainFacilityFilter,
            elderId,
            emergencyEventId: emergencyEventIds.overdueOpen,
            sourceBindingId: emergencySourceBindingId,
            sourceKind: 'IOT_BUTTON',
            sourceIdentityKey: `binding:${emergencySourceBindingId}`,
            externalEventId: 'seed-iot-emergency-0001',
            requestFingerprint: '1'.repeat(64),
            schemaVersion: '1.0',
            observedAt: emergencyOpenAt,
            receivedAt: emergencyOpenAt,
            reasonCode: 'IOT_EMERGENCY_BUTTON',
            correlationId: 'seed-m04-overdue-open',
          },
          {
            id: fixedId('b4400000', 2),
            ...mainFacilityFilter,
            elderId,
            emergencyEventId: emergencyEventIds.responding,
            sourceUserId: ids.users.supervisor,
            sourceKind: 'STAFF_MANUAL',
            sourceIdentityKey: `user:${ids.users.supervisor}`,
            externalEventId: 'seed-staff-emergency-0001',
            requestFingerprint: '2'.repeat(64),
            schemaVersion: '1.0',
            observedAt: emergencyRespondingOpenedAt,
            receivedAt: emergencyRespondingOpenedAt,
            reasonCode: 'STAFF_REPORTED_EMERGENCY',
            correlationId: 'seed-m04-responding',
          },
          {
            id: fixedId('b4400000', 3),
            ...mainFacilityFilter,
            elderId,
            emergencyEventId: emergencyEventIds.reviewed,
            sourceUserId: ids.users.supervisor,
            sourceKind: 'STAFF_MANUAL',
            sourceIdentityKey: `user:${ids.users.supervisor}`,
            externalEventId: 'seed-staff-emergency-0002',
            requestFingerprint: '3'.repeat(64),
            schemaVersion: '1.0',
            observedAt: emergencyReviewedOpenedAt,
            receivedAt: emergencyReviewedOpenedAt,
            reasonCode: 'STAFF_REPORTED_EMERGENCY',
            correlationId: 'seed-m04-reviewed',
          },
          {
            id: fixedId('b4400000', 4),
            ...mainFacilityFilter,
            elderId,
            emergencyEventId: emergencyEventIds.relatedOpen,
            sourceBindingId: emergencySourceBindingId,
            sourceKind: 'IOT_BUTTON',
            sourceIdentityKey: `binding:${emergencySourceBindingId}`,
            externalEventId: 'seed-iot-emergency-0002',
            requestFingerprint: '4'.repeat(64),
            schemaVersion: '1.0',
            observedAt: emergencyRelatedAt,
            receivedAt: emergencyRelatedAt,
            reasonCode: 'IOT_EMERGENCY_BUTTON',
            correlationId: 'seed-m04-related-open',
          },
        ],
      });
      await transaction.emergencyLocationSnapshot.createMany({
        data: [
          {
            id: fixedId('b4500000', 1),
            ...mainFacilityFilter,
            elderId,
            emergencyEventId: emergencyEventIds.overdueOpen,
            state: 'STALE',
            source: 'IOT_LAST_KNOWN',
            floorId: floorIds[0],
            roomId: roomIds[0],
            observedAt: new Date(emergencyOpenAt.getTime() - 10 * 60 * 1000),
            expiresAt: new Date(emergencyOpenAt.getTime() - 9 * 60 * 1000),
            decidedAt: emergencyOpenAt,
            retentionUntil: new Date(seedStartedAt + 24 * HOUR),
            fallbackReasonCode: 'LOCATION_EXPIRED',
          },
          {
            id: fixedId('b4500000', 2),
            ...mainFacilityFilter,
            elderId,
            emergencyEventId: emergencyEventIds.responding,
            state: 'CURRENT',
            source: 'FACILITY_BEACON',
            floorId: floorIds[0],
            roomId: roomIds[0],
            normalizedX: 0.42,
            normalizedY: 0.58,
            accuracyMeters: 6.5,
            observedAt: emergencyOnSiteAt,
            expiresAt: new Date(seedStartedAt + 5 * 60 * 1000),
            decidedAt: emergencyOnSiteAt,
            retentionUntil: new Date(seedStartedAt + 24 * HOUR),
          },
          {
            id: fixedId('b4500000', 3),
            ...mainFacilityFilter,
            elderId,
            emergencyEventId: emergencyEventIds.reviewed,
            state: 'ROOM_FALLBACK',
            source: 'ELDER_STAY',
            floorId: floorIds[0],
            roomId: roomIds[0],
            decidedAt: emergencyReviewedOpenedAt,
            retentionUntil: new Date(seedStartedAt + 24 * HOUR),
            fallbackReasonCode: 'NO_FRESH_LOCATION',
          },
          {
            id: fixedId('b4500000', 4),
            ...mainFacilityFilter,
            elderId,
            emergencyEventId: emergencyEventIds.relatedOpen,
            state: 'UNKNOWN',
            source: 'UNKNOWN',
            decidedAt: emergencyRelatedAt,
            retentionUntil: new Date(seedStartedAt + 24 * HOUR),
            fallbackReasonCode: 'NO_LOCATION_AVAILABLE',
          },
        ],
      });
      await transaction.emergencyTransition.createMany({
        data: [
          { id: fixedId('b4600000', 1), ...mainFacilityFilter, emergencyEventId: emergencyEventIds.overdueOpen, fromStatus: null, toStatus: 'OPEN', fromVersion: 0, toVersion: 1, actorType: 'DEVICE', actorExternalId: 'call-device-qinglan-001', reasonCode: 'IOT_EMERGENCY_BUTTON', correlationId: 'seed-m04-overdue-open', occurredAt: emergencyOpenAt },
          { id: fixedId('b4600000', 2), ...mainFacilityFilter, emergencyEventId: emergencyEventIds.responding, fromStatus: null, toStatus: 'OPEN', fromVersion: 0, toVersion: 1, actorType: 'USER', actorUserId: ids.users.supervisor, reasonCode: 'STAFF_REPORTED_EMERGENCY', correlationId: 'seed-m04-responding', occurredAt: emergencyRespondingOpenedAt },
          { id: fixedId('b4600000', 3), ...mainFacilityFilter, emergencyEventId: emergencyEventIds.responding, fromStatus: 'OPEN', toStatus: 'ACKNOWLEDGED', fromVersion: 1, toVersion: 2, actorType: 'USER', actorUserId: ids.users.caregiver, reasonCode: 'CAREGIVER_ACKNOWLEDGED', correlationId: 'seed-m04-responding', occurredAt: emergencyRespondingAcknowledgedAt },
          { id: fixedId('b4600000', 4), ...mainFacilityFilter, emergencyEventId: emergencyEventIds.responding, fromStatus: 'ACKNOWLEDGED', toStatus: 'RESPONDING', fromVersion: 2, toVersion: 3, actorType: 'USER', actorUserId: ids.users.caregiver, reasonCode: 'CAREGIVER_EN_ROUTE', correlationId: 'seed-m04-responding', occurredAt: emergencyRespondingAt },
          { id: fixedId('b4600000', 5), ...mainFacilityFilter, emergencyEventId: emergencyEventIds.reviewed, fromStatus: null, toStatus: 'OPEN', fromVersion: 0, toVersion: 1, actorType: 'USER', actorUserId: ids.users.supervisor, reasonCode: 'STAFF_REPORTED_EMERGENCY', correlationId: 'seed-m04-reviewed', occurredAt: emergencyReviewedOpenedAt },
          { id: fixedId('b4600000', 6), ...mainFacilityFilter, emergencyEventId: emergencyEventIds.reviewed, fromStatus: 'OPEN', toStatus: 'ACKNOWLEDGED', fromVersion: 1, toVersion: 2, actorType: 'USER', actorUserId: ids.users.caregiver, reasonCode: 'CAREGIVER_ACKNOWLEDGED', correlationId: 'seed-m04-reviewed', occurredAt: emergencyReviewedAcknowledgedAt },
          { id: fixedId('b4600000', 7), ...mainFacilityFilter, emergencyEventId: emergencyEventIds.reviewed, fromStatus: 'ACKNOWLEDGED', toStatus: 'RESPONDING', fromVersion: 2, toVersion: 3, actorType: 'USER', actorUserId: ids.users.caregiver, reasonCode: 'CAREGIVER_EN_ROUTE', correlationId: 'seed-m04-reviewed', occurredAt: emergencyReviewedRespondingAt },
          { id: fixedId('b4600000', 8), ...mainFacilityFilter, emergencyEventId: emergencyEventIds.reviewed, fromStatus: 'RESPONDING', toStatus: 'RESOLVED', fromVersion: 4, toVersion: 5, actorType: 'USER', actorUserId: ids.users.caregiver, reasonCode: 'CAREGIVER_RESOLVED', correlationId: 'seed-m04-reviewed', occurredAt: emergencyResolvedAt },
          { id: fixedId('b4600000', 9), ...mainFacilityFilter, emergencyEventId: emergencyEventIds.reviewed, fromStatus: 'RESOLVED', toStatus: 'REVIEWED', fromVersion: 5, toVersion: 6, actorType: 'USER', actorUserId: ids.users.supervisor, reasonCode: 'SUPERVISOR_REVIEW_COMPLETED', correlationId: 'seed-m04-reviewed', occurredAt: emergencyReviewedAt },
          { id: fixedId('b4600000', 10), ...mainFacilityFilter, emergencyEventId: emergencyEventIds.relatedOpen, fromStatus: null, toStatus: 'OPEN', fromVersion: 0, toVersion: 1, actorType: 'DEVICE', actorExternalId: 'call-device-qinglan-001', reasonCode: 'IOT_EMERGENCY_BUTTON', correlationId: 'seed-m04-related-open', occurredAt: emergencyRelatedAt },
        ],
      });
      await transaction.emergencyRelatedEvent.create({
        data: {
          id: fixedId('b4700000', 1),
          ...mainFacilityFilter,
          primaryEventId: emergencyEventIds.overdueOpen,
          relatedEventId: emergencyEventIds.relatedOpen,
          reasonCode: 'NEAR_DUPLICATE_WINDOW',
          correlationId: 'seed-m04-related-open',
        },
      });
      await transaction.emergencyResponder.createMany({
        data: [
          {
            id: fixedId('b4900000', 1),
            ...mainFacilityFilter,
            emergencyEventId: emergencyEventIds.responding,
            staffProfileId: caregiverStaffIds[0] ?? '',
            shiftAssignmentId: fixedId('96000000', 1),
            teamId: teamIds[0],
            status: 'ACKNOWLEDGED',
            assignedByUserId: ids.users.supervisor,
            assignedAt: new Date(emergencyRespondingOpenedAt.getTime() + 15_000),
            acknowledgedAt: emergencyRespondingAcknowledgedAt,
            reasonCode: 'CURRENT_SHIFT_RESPONDER',
          },
          {
            id: fixedId('b4900000', 2),
            ...mainFacilityFilter,
            emergencyEventId: emergencyEventIds.reviewed,
            staffProfileId: caregiverStaffIds[0] ?? '',
            shiftAssignmentId: fixedId('96000000', 1),
            teamId: teamIds[0],
            status: 'RELEASED',
            assignedByUserId: ids.users.supervisor,
            assignedAt: new Date(emergencyReviewedOpenedAt.getTime() + 15_000),
            acknowledgedAt: emergencyReviewedAcknowledgedAt,
            releasedAt: emergencyResolvedAt,
            reasonCode: 'CURRENT_SHIFT_RESPONDER',
          },
        ],
      });
      await transaction.emergencyAcknowledgement.createMany({
        data: [
          {
            id: fixedId('b4800000', 1),
            ...mainFacilityFilter,
            emergencyEventId: emergencyEventIds.responding,
            staffProfileId: caregiverStaffIds[0] ?? '',
            shiftAssignmentId: fixedId('96000000', 1),
            actorUserId: ids.users.caregiver,
            acknowledgedAt: emergencyRespondingAcknowledgedAt,
            correlationId: 'seed-m04-responding',
          },
          {
            id: fixedId('b4800000', 2),
            ...mainFacilityFilter,
            emergencyEventId: emergencyEventIds.reviewed,
            staffProfileId: caregiverStaffIds[0] ?? '',
            shiftAssignmentId: fixedId('96000000', 1),
            actorUserId: ids.users.caregiver,
            acknowledgedAt: emergencyReviewedAcknowledgedAt,
            correlationId: 'seed-m04-reviewed',
          },
        ],
      });
      await transaction.emergencyResponseMilestone.createMany({
        data: [
          { id: fixedId('b4a00000', 1), ...mainFacilityFilter, emergencyEventId: emergencyEventIds.responding, kind: 'EN_ROUTE', staffProfileId: caregiverStaffIds[0] ?? '', actorUserId: ids.users.caregiver, fromVersion: 2, toVersion: 3, occurredAt: emergencyRespondingAt, reasonCode: 'CAREGIVER_EN_ROUTE', correlationId: 'seed-m04-responding' },
          { id: fixedId('b4a00000', 2), ...mainFacilityFilter, emergencyEventId: emergencyEventIds.responding, kind: 'ON_SITE', staffProfileId: caregiverStaffIds[0] ?? '', actorUserId: ids.users.caregiver, fromVersion: 3, toVersion: 4, occurredAt: emergencyOnSiteAt, reasonCode: 'CAREGIVER_ON_SITE', correlationId: 'seed-m04-responding' },
          { id: fixedId('b4a00000', 3), ...mainFacilityFilter, emergencyEventId: emergencyEventIds.reviewed, kind: 'EN_ROUTE', staffProfileId: caregiverStaffIds[0] ?? '', actorUserId: ids.users.caregiver, fromVersion: 2, toVersion: 3, occurredAt: emergencyReviewedRespondingAt, reasonCode: 'CAREGIVER_EN_ROUTE', correlationId: 'seed-m04-reviewed' },
          { id: fixedId('b4a00000', 4), ...mainFacilityFilter, emergencyEventId: emergencyEventIds.reviewed, kind: 'ON_SITE', staffProfileId: caregiverStaffIds[0] ?? '', actorUserId: ids.users.caregiver, fromVersion: 3, toVersion: 4, occurredAt: emergencyReviewedOnSiteAt, reasonCode: 'CAREGIVER_ON_SITE', correlationId: 'seed-m04-reviewed' },
        ],
      });
      await transaction.emergencyEscalation.createMany({
        data: [
          {
            id: fixedId('b4b00000', 1),
            ...mainFacilityFilter,
            emergencyEventId: emergencyEventIds.overdueOpen,
            escalationStepId: emergencyStepIds.acknowledgement,
            stage: 'ACKNOWLEDGEMENT',
            status: 'TRIGGERED',
            dueAt: new Date(emergencyOpenAt.getTime() + 60_000),
            basisTransitionVersion: 1,
            idempotencyKey: 'seed-m04-overdue-open:ack:1',
            triggeredAt: new Date(emergencyOpenAt.getTime() + 60_000),
            correlationId: 'seed-m04-overdue-open',
          },
          {
            id: fixedId('b4b00000', 2),
            ...mainFacilityFilter,
            emergencyEventId: emergencyEventIds.relatedOpen,
            escalationStepId: emergencyStepIds.acknowledgement,
            stage: 'ACKNOWLEDGEMENT',
            status: 'SCHEDULED',
            dueAt: new Date(emergencyRelatedAt.getTime() + 60_000),
            basisTransitionVersion: 1,
            idempotencyKey: 'seed-m04-related-open:ack:1',
            correlationId: 'seed-m04-related-open',
          },
          {
            id: fixedId('b4b00000', 3),
            ...mainFacilityFilter,
            emergencyEventId: emergencyEventIds.responding,
            escalationStepId: emergencyStepIds.acknowledgement,
            stage: 'ACKNOWLEDGEMENT',
            status: 'CANCELLED',
            dueAt: new Date(emergencyRespondingOpenedAt.getTime() + 60_000),
            basisTransitionVersion: 1,
            idempotencyKey: 'seed-m04-responding:ack:1',
            cancelledAt: emergencyRespondingAcknowledgedAt,
            correlationId: 'seed-m04-responding',
          },
          {
            id: fixedId('b4b00000', 4),
            ...mainFacilityFilter,
            emergencyEventId: emergencyEventIds.responding,
            escalationStepId: emergencyStepIds.arrival,
            stage: 'ARRIVAL',
            status: 'CANCELLED',
            dueAt: new Date(emergencyRespondingAcknowledgedAt.getTime() + 300_000),
            basisTransitionVersion: 2,
            idempotencyKey: 'seed-m04-responding:arrival:2',
            cancelledAt: emergencyOnSiteAt,
            correlationId: 'seed-m04-responding',
          },
          {
            id: fixedId('b4b00000', 5),
            ...mainFacilityFilter,
            emergencyEventId: emergencyEventIds.responding,
            escalationStepId: emergencyStepIds.resolution,
            stage: 'RESOLUTION',
            status: 'SCHEDULED',
            dueAt: new Date(emergencyRespondingAt.getTime() + 900_000),
            basisTransitionVersion: 4,
            idempotencyKey: 'seed-m04-responding:resolution:4',
            correlationId: 'seed-m04-responding',
          },
        ],
      });
      const emergencyResolutionChecklist = {
        schemaVersion: 1,
        expectedCodes: [
          'SCENE_SAFETY_CONFIRMED',
          'ELDER_STATE_CONFIRMED',
          'FOLLOW_UP_HANDOFF_CONFIRMED',
        ],
        confirmations: [
          { code: 'SCENE_SAFETY_CONFIRMED', confirmed: true, confirmedAt: emergencyResolvedAt.toISOString() },
          { code: 'ELDER_STATE_CONFIRMED', confirmed: true, confirmedAt: emergencyResolvedAt.toISOString() },
          { code: 'FOLLOW_UP_HANDOFF_CONFIRMED', confirmed: true, confirmedAt: emergencyResolvedAt.toISOString() },
        ],
      };
      await transaction.emergencyResolution.create({
        data: {
          id: fixedId('b4c00000', 1),
          ...mainFacilityFilter,
          emergencyEventId: emergencyEventIds.reviewed,
          resolvedByUserId: ids.users.caregiver,
          staffProfileId: caregiverStaffIds[0] ?? '',
          summary: '现场环境已确认安全，老人状态稳定，并已交接后续观察。',
          outcomeCode: 'SAFE_WITH_FOLLOW_UP',
          familyNotify: true,
          completionChecklist: emergencyResolutionChecklist,
          resolvedAt: emergencyResolvedAt,
          correlationId: 'seed-m04-reviewed',
        },
      });
      await transaction.emergencyReview.create({
        data: {
          id: fixedId('b4d00000', 1),
          ...mainFacilityFilter,
          emergencyEventId: emergencyEventIds.reviewed,
          reviewedByUserId: ids.users.supervisor,
          kind: 'COMPLETED',
          summary: '复盘确认人工响应、现场处置和后续交接记录完整。',
          reviewedAt: emergencyReviewedAt,
          correlationId: 'seed-m04-reviewed',
        },
      });
      await transaction.familyEmergencyNotificationPreference.create({
        data: {
          id: fixedId('b4e00000', 1),
          ...mainFacilityFilter,
          elderId,
          familyRelationshipId: fixedId('8a000000', 1),
          enabled: true,
          notifyOnOpened: false,
          notifyOnResolved: true,
          channel: 'IN_APP',
          updatedByUserId: ids.users.family,
          version: 1,
        },
      });
      await transaction.emergencyFamilySummary.createMany({
        data: [
          {
            id: fixedId('b4f00000', 1),
            ...mainFacilityFilter,
            elderId,
            emergencyEventId: emergencyEventIds.reviewed,
            stage: 'RESOLVED',
            title: '现场处置已完成',
            summary: '机构工作人员已完成现场安全处置，并安排后续观察。',
            publishedAt: emergencyResolvedAt,
            correlationId: 'seed-m04-reviewed',
          },
          {
            id: fixedId('b4f00000', 2),
            ...mainFacilityFilter,
            elderId,
            emergencyEventId: emergencyEventIds.reviewed,
            stage: 'REVIEWED',
            title: '事件复盘已完成',
            summary: '机构已完成本次事件复盘，后续照护安排保持有效。',
            publishedAt: emergencyReviewedAt,
            correlationId: 'seed-m04-reviewed',
          },
        ],
      });
      await transaction.emergencyNotificationDelivery.create({
        data: {
          id: fixedId('b5000000', 1),
          ...mainFacilityFilter,
          emergencyEventId: emergencyEventIds.reviewed,
          familyRelationshipId: fixedId('8a000000', 1),
          stage: 'RESOLVED',
          channel: 'IN_APP',
          status: 'DELIVERED',
          providerKey: 'seed-m04-reviewed:family-1:resolved:in-app',
          attempts: 1,
          deliveredAt: new Date(emergencyResolvedAt.getTime() + 5_000),
          correlationId: 'seed-m04-reviewed',
        },
      });
      await transaction.elderTimelineEntry.createMany({
        data: [
          {
            id: fixedId('b5100000', 1),
            ...mainFacilityFilter,
            elderId,
            eventType: 'EMERGENCY_RESPONDING',
            sourceResourceType: 'EMERGENCY_EVENT',
            sourceResourceId: emergencyEventIds.responding,
            visibility: 'ELDER_VISIBLE',
            safeSummaryCode: 'HUMAN_RESPONSE_IN_PROGRESS',
            safeMetadata: { status: 'RESPONDING' },
            actorUserId: ids.users.caregiver,
            correlationId: 'seed-m04-responding',
            occurredAt: emergencyRespondingAt,
          },
          {
            id: fixedId('b5100000', 2),
            ...mainFacilityFilter,
            elderId,
            eventType: 'EMERGENCY_REVIEWED',
            sourceResourceType: 'EMERGENCY_EVENT',
            sourceResourceId: emergencyEventIds.reviewed,
            visibility: 'FAMILY_ELIGIBLE',
            safeSummaryCode: 'EMERGENCY_REVIEW_COMPLETED',
            safeMetadata: { stage: 'REVIEWED' },
            actorUserId: ids.users.supervisor,
            correlationId: 'seed-m04-reviewed',
            occurredAt: emergencyReviewedAt,
          },
        ],
      });

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
            safeMetadata: { fictionalDemoData: true, schemaVersion: '1.2', milestone: 'M02', counts: M02_SEED_EXPECTATIONS },
          },
          {
            id: ids.auditM03,
            organizationId: ids.organizations.qinglan,
            facilityId: ids.facilities.qinglanMain,
            actorType: 'SYSTEM',
            action: 'SYSTEM.M03_SEED_APPLIED',
            outcome: 'SUCCESS',
            resourceType: 'milestone',
            resourceId: 'M03',
            correlationId: 'seed-m03-needs-workorders',
            safeMetadata: { fictionalDemoData: true, schemaVersion: '1.3', milestone: 'M03', counts: M03_AUDIT_SAFE_COUNTS },
          },
          {
            id: ids.auditM04,
            organizationId: ids.organizations.qinglan,
            facilityId: ids.facilities.qinglanMain,
            actorType: 'SYSTEM',
            action: 'SYSTEM.M04_SEED_APPLIED',
            outcome: 'SUCCESS',
            resourceType: 'milestone',
            resourceId: 'M04',
            correlationId: 'seed-m04-emergency',
            safeMetadata: {
              fictionalDemoData: true,
              schemaVersion: '1.4',
              milestone: 'M04',
              counts: M04_SEED_EXPECTATIONS,
            },
          },
        ],
        skipDuplicates: true,
      });

      await transaction.systemMetadata.upsert({
        where: { key: 'foundation.seed' },
        create: {
          key: 'foundation.seed',
          value: { schemaVersion: '1.4', milestone: 'M04', containsBusinessFixtures: true, fictionalDemoData: true },
        },
        update: {
          value: { schemaVersion: '1.4', milestone: 'M04', containsBusinessFixtures: true, fictionalDemoData: true },
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

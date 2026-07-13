import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { isRole, type Role } from '@eldercare/authz';
import type {
  ReplaceUserAccessRequest,
  RoleListItem,
  RolesPage,
  RolesQuery,
  UserSummary,
  UsersPage,
  UsersQuery,
} from '@eldercare/contracts';
import type { Prisma } from '@eldercare/db';
import { AuditService } from '../audit/audit.service.js';
import { SessionService } from '../auth/session.service.js';
import type { AuthenticatedSession } from '../auth/auth.types.js';
import { SafeHttpException } from '../common/safe-http.exception.js';
import { DatabaseService } from '../database/database.service.js';
import { resourceNotFound } from '../authorization/tenant-context.service.js';

const activeAssignmentWhere = (organizationId: string, facilityId: string, now: Date) => ({
  organizationId,
  activeFrom: { lte: now },
  revokedAt: null,
  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  dataScopes: {
    some: {
      validFrom: { lte: now },
      OR: [
        { validUntil: null },
        { validUntil: { gt: now } },
      ],
      AND: [{ OR: [{ facilityId }, { kind: 'ORGANIZATION' as const }] }],
    },
  },
});

const visibleScopeWhere = (facilityId: string, now: Date) => ({
  validFrom: { lte: now },
  OR: [{ validUntil: null }, { validUntil: { gt: now } }],
  AND: [
    {
      OR: [
        { facilityId },
        { kind: 'ORGANIZATION' as const },
        { kind: 'OWN_RECORD' as const },
      ],
    },
  ],
});

const userInclude = (organizationId: string, facilityId: string, now: Date) => ({
  userRoles: {
    where: activeAssignmentWhere(organizationId, facilityId, now),
    include: {
      role: { include: { rolePermissions: { include: { permission: true } } } },
      dataScopes: {
        where: visibleScopeWhere(facilityId, now),
        orderBy: [{ kind: 'asc' as const }, { scopeKey: 'asc' as const }],
      },
    },
    orderBy: [{ role: { code: 'asc' as const } }, { activeFrom: 'asc' as const }],
  },
});

type VisibleUser = Prisma.UserGetPayload<{
  include: ReturnType<typeof userInclude>;
}>;

@Injectable()
export class IdentityService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  async listUsers(
    organizationId: string,
    facilityId: string,
    query: UsersQuery,
    session: AuthenticatedSession,
    correlationId: string,
  ): Promise<UsersPage> {
    assertOptionalRouteFilter(query.organizationId, organizationId);
    assertOptionalRouteFilter(query.facilityId, facilityId);
    const now = new Date();
    const assignmentWhere = activeAssignmentWhere(organizationId, facilityId, now);
    const where: Prisma.UserWhereInput = {
      userRoles: { some: assignmentWhere },
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.search === undefined || query.search.length === 0
        ? {}
        : {
            OR: [
              { loginName: { contains: query.search, mode: 'insensitive' } },
              { displayName: { contains: query.search, mode: 'insensitive' } },
            ],
          }),
    };
    const orderBy = userOrderBy(query.sort, query.direction);
    const skip = (query.page - 1) * query.pageSize;
    const [total, users] = await this.database.client.$transaction([
      this.database.client.user.count({ where }),
      this.database.client.user.findMany({
        where,
        include: userInclude(organizationId, facilityId, now),
        orderBy,
        skip,
        take: query.pageSize,
      }),
    ]);
    const items = users.map(mapUser);
    await this.auditSensitiveRead(
      'IDENTITY.USERS_READ',
      'USER_DIRECTORY',
      organizationId,
      facilityId,
      session,
      correlationId,
      query.page,
      query.pageSize,
      items.length,
    );
    return { items, pageInfo: pageInfo(query.page, query.pageSize, total) };
  }

  async getUser(
    organizationId: string,
    facilityId: string,
    userId: string,
    session: AuthenticatedSession,
    correlationId: string,
  ): Promise<UserSummary> {
    const user = await this.findVisibleUser(organizationId, facilityId, userId);
    if (user === null) throw resourceNotFound();
    await this.auditSensitiveRead(
      'IDENTITY.USER_READ',
      'USER',
      organizationId,
      facilityId,
      session,
      correlationId,
      1,
      1,
      1,
      userId,
    );
    return mapUser(user);
  }

  async listRoles(
    organizationId: string,
    facilityId: string,
    query: RolesQuery,
    session: AuthenticatedSession,
    correlationId: string,
  ): Promise<RolesPage> {
    const where: Prisma.RoleWhereInput =
      query.search === undefined || query.search.length === 0
        ? {}
        : {
            OR: [
              { code: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
            ],
          };
    const skip = (query.page - 1) * query.pageSize;
    const now = new Date();
    const include = {
      rolePermissions: { include: { permission: true } },
      userAssignments: {
        where: activeAssignmentWhere(organizationId, facilityId, now),
        select: {
          userId: true,
          dataScopes: {
            where: visibleScopeWhere(facilityId, now),
            select: { kind: true },
          },
        },
      },
    } as const;
    if (query.sort === 'assignedUserCount') {
      const [total, allRoles] = await this.database.client.$transaction([
        this.database.client.role.count({ where }),
        this.database.client.role.findMany({ where, include, orderBy: { code: 'asc' } }),
      ]);
      const sorted = allRoles.map(mapRoleListItem).sort((left, right) => {
        const difference = left.assignedUserCount - right.assignedUserCount;
        return query.direction === 'asc' ? difference : -difference;
      });
      const items = sorted.slice(skip, skip + query.pageSize);
      await this.auditSensitiveRead(
        'IDENTITY.ROLES_READ',
        'ROLE_DIRECTORY',
        organizationId,
        facilityId,
        session,
        correlationId,
        query.page,
        query.pageSize,
        items.length,
      );
      return { items, pageInfo: pageInfo(query.page, query.pageSize, total) };
    }
    const [total, roles] = await this.database.client.$transaction([
      this.database.client.role.count({ where }),
      this.database.client.role.findMany({
        where,
        include,
        orderBy: roleOrderBy(query.sort, query.direction),
        skip,
        take: query.pageSize,
      }),
    ]);
    const items = roles.map(mapRoleListItem);
    await this.auditSensitiveRead(
      'IDENTITY.ROLES_READ',
      'ROLE_DIRECTORY',
      organizationId,
      facilityId,
      session,
      correlationId,
      query.page,
      query.pageSize,
      items.length,
    );
    return { items, pageInfo: pageInfo(query.page, query.pageSize, total) };
  }

  async getRole(
    organizationId: string,
    facilityId: string,
    roleId: string,
    session: AuthenticatedSession,
    correlationId: string,
  ): Promise<RoleListItem> {
    const now = new Date();
    const role = await this.database.client.role.findUnique({
      where: { id: roleId },
      include: {
        rolePermissions: { include: { permission: true } },
        userAssignments: {
          where: activeAssignmentWhere(organizationId, facilityId, now),
          select: {
            userId: true,
            dataScopes: {
              where: visibleScopeWhere(facilityId, now),
              select: { kind: true },
            },
          },
        },
      },
    });
    if (role === null) throw resourceNotFound();
    await this.auditSensitiveRead(
      'IDENTITY.ROLE_READ',
      'ROLE',
      organizationId,
      facilityId,
      session,
      correlationId,
      1,
      1,
      1,
      roleId,
    );
    return mapRoleListItem(role);
  }

  async replaceUserAccess(
    organizationId: string,
    facilityId: string,
    userId: string,
    input: ReplaceUserAccessRequest,
    session: AuthenticatedSession,
    correlationId: string,
  ): Promise<UserSummary> {
    if (input.organizationId !== organizationId) throw resourceNotFound();
    const currentUser = await this.findVisibleUser(organizationId, facilityId, userId);
    if (currentUser === null) throw resourceNotFound();
    if (currentUser.accessVersion !== input.expectedAccessVersion) throw accessConflict();
    const visibleAssignmentIds = currentUser.userRoles.map((assignment) => assignment.id);
    if (visibleAssignmentIds.length > 0) {
      const existingAssignments = await this.database.client.userRole.findMany({
        where: { id: { in: visibleAssignmentIds } },
        select: {
          role: { select: { code: true } },
          dataScopes: { select: { kind: true, facilityId: true } },
        },
      });
      if (existingAssignments.some((assignment) =>
        assignment.role.code === 'PLATFORM_ADMIN' ||
        assignment.role.code === 'ORG_ADMIN' ||
        assignment.dataScopes.some((scope) =>
          scope.kind === 'PLATFORM' || scope.kind === 'ORGANIZATION'
        ),
      )) {
        throw new SafeHttpException(
          HttpStatus.FORBIDDEN,
          'FORBIDDEN',
          '院区级接口不能修改机构级或平台级授权',
        );
      }
      if (existingAssignments.some((assignment) =>
        assignment.dataScopes.some((scope) =>
          scope.facilityId !== null && scope.facilityId !== facilityId,
        ),
      )) {
        throw new SafeHttpException(
          HttpStatus.CONFLICT,
          'MULTI_FACILITY_ASSIGNMENT_CONFLICT',
          '该用户存在跨院区的组合授权，请先拆分授权后重试',
        );
      }
    }

    const roleIds = [...new Set(input.assignments.map((assignment) => assignment.roleId))];
    if (roleIds.length !== input.assignments.length) {
      throw invalidAccessRequest('assignments.roleId', 'ROLE_DUPLICATE');
    }
    const roles = await this.database.client.role.findMany({
      where: { id: { in: roleIds } },
      include: { rolePermissions: { include: { permission: true } } },
    });
    if (roles.length !== roleIds.length) throw invalidAccessRequest('assignments.roleId', 'ROLE_INVALID');
    const rolesById = new Map(roles.map((role) => [role.id, role]));
    const actorPermissions = new Set(session.principal.permissions);
    for (const role of roles) {
      if (role.code === 'PLATFORM_ADMIN' || role.code === 'ORG_ADMIN') {
        throw invalidAccessRequest('assignments.roleId', 'ROLE_SCOPE_INVALID');
      }
      if (role.rolePermissions.some((entry) => !actorPermissions.has(entry.permission.code))) {
        throw new SafeHttpException(
          HttpStatus.FORBIDDEN,
          'FORBIDDEN',
          '当前身份无权分配包含额外权限的角色',
        );
      }
    }

    const normalizedAssignments = input.assignments.map((assignment, index) =>
      normalizeAssignment(assignment, index, facilityId),
    );
    const roleKeys = normalizedAssignments
      .map((assignment) => rolesById.get(assignment.roleId)?.code)
      .filter((value): value is string => value !== undefined)
      .sort();
    const scopeKinds = [...new Set(normalizedAssignments.flatMap((assignment) =>
      assignment.scopes.map((scope) => scope.kind),
    ))].sort();

    await this.database.client.$transaction(async (transaction) => {
      const updated = await transaction.user.updateMany({
        where: { id: userId, accessVersion: input.expectedAccessVersion },
        data: { accessVersion: { increment: 1 }, sessionVersion: { increment: 1 } },
      });
      if (updated.count !== 1) throw accessConflict();

      if (visibleAssignmentIds.length > 0) {
        await transaction.userRole.updateMany({
          where: { id: { in: visibleAssignmentIds }, revokedAt: null },
          data: { revokedAt: new Date(), revokedByUserId: session.userId },
        });
      }
      for (const assignment of normalizedAssignments) {
        await transaction.userRole.create({
          data: {
            userId,
            roleId: assignment.roleId,
            organizationId,
            activeFrom: assignment.activeFrom,
            expiresAt: assignment.expiresAt,
            createdByUserId: session.userId,
            dataScopes: {
              create: assignment.scopes.map((scope) => ({
                kind: scope.kind,
                scopeKey: scope.scopeKey,
                facilityId: scope.facilityId,
                validFrom: scope.validFrom,
                validUntil: scope.validUntil,
              })),
            },
          },
        });
      }
      await this.sessions.revokeAllForUser(userId, 'ACCESS_CHANGED', transaction);
      await this.audit.record(
        {
          organizationId,
          facilityId,
          actorUserId: session.userId,
          actorType: 'USER',
          action: 'IDENTITY.USER_ACCESS_REPLACED',
          outcome: 'SUCCESS',
          resourceType: 'USER',
          resourceId: userId,
          correlationId,
          metadata: { roleKeys, scopeKinds },
        },
        transaction,
      );
    });

    const updatedUser = await this.findVisibleUser(organizationId, facilityId, userId);
    if (updatedUser === null && normalizedAssignments.length === 0) {
      return {
        id: currentUser.id,
        loginName: currentUser.loginName,
        displayName: currentUser.displayName,
        status: currentUser.status,
        lastLoginAt: currentUser.lastLoginAt?.toISOString() ?? null,
        accessVersion: currentUser.accessVersion + 1,
        assignments: [],
      };
    }
    if (updatedUser === null) throw resourceNotFound();
    return mapUser(updatedUser);
  }

  private findVisibleUser(
    organizationId: string,
    facilityId: string,
    userId: string,
  ): Promise<VisibleUser | null> {
    const now = new Date();
    return this.database.client.user.findFirst({
      where: {
        id: userId,
        userRoles: { some: activeAssignmentWhere(organizationId, facilityId, now) },
      },
      include: userInclude(organizationId, facilityId, now),
    });
  }

  private async auditSensitiveRead(
    action: string,
    resourceType: string,
    organizationId: string,
    facilityId: string,
    session: AuthenticatedSession,
    correlationId: string,
    page: number,
    pageSize: number,
    resultCount: number,
    resourceId?: string,
  ): Promise<void> {
    await this.audit.record({
      organizationId,
      facilityId,
      actorUserId: session.userId,
      actorType: 'USER',
      action,
      outcome: 'SUCCESS',
      resourceType,
      resourceId,
      correlationId,
      metadata: { page, pageSize, resultCount },
    });
  }
}

function mapUser(user: VisibleUser): UserSummary {
  return {
    id: user.id,
    loginName: user.loginName,
    displayName: user.displayName,
    status: user.status,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    accessVersion: user.accessVersion,
    assignments: user.userRoles.map((assignment) => ({
      id: assignment.id,
      organizationId: assignment.organizationId,
      role: {
        id: assignment.role.id,
        code: roleCode(assignment.role.code),
        name: assignment.role.name,
        description: assignment.role.description,
        isSystem: assignment.role.isSystem,
        permissions: assignment.role.rolePermissions
          .map((entry) => entry.permission.code)
          .sort(),
      },
      scopes: assignment.dataScopes.map((scope) => ({
        id: scope.id,
        kind: scope.kind,
        scopeKey: scope.scopeKey,
        organizationId: scope.organizationId,
        facilityId: scope.facilityId,
        resourceType: scope.resourceType,
        resourceId: scope.resourceId,
        validFrom: scope.validFrom.toISOString(),
        validUntil: scope.validUntil?.toISOString() ?? null,
      })),
      activeFrom: assignment.activeFrom.toISOString(),
      expiresAt: assignment.expiresAt?.toISOString() ?? null,
    })),
  };
}

function mapRoleListItem(role: {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly isSystem: boolean;
  readonly rolePermissions: readonly { readonly permission: { readonly code: string } }[];
  readonly userAssignments: readonly {
    readonly userId: string;
    readonly dataScopes: readonly { readonly kind: RoleListItem['scopeKinds'][number] }[];
  }[];
}): RoleListItem {
  return {
    id: role.id,
    code: roleCode(role.code),
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissions: role.rolePermissions.map((entry) => entry.permission.code).sort(),
    assignedUserCount: new Set(role.userAssignments.map((assignment) => assignment.userId)).size,
    scopeKinds: [...new Set(role.userAssignments.flatMap((assignment) =>
      assignment.dataScopes.map((scope) => scope.kind),
    ))].sort(),
  };
}

function pageInfo(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize) };
}

function userOrderBy(sort: UsersQuery['sort'], direction: UsersQuery['direction']): Prisma.UserOrderByWithRelationInput {
  if (sort === 'loginName') return { loginName: direction };
  if (sort === 'status') return { status: direction };
  if (sort === 'lastLoginAt') return { lastLoginAt: direction };
  return { displayName: direction };
}

function roleOrderBy(sort: RolesQuery['sort'], direction: RolesQuery['direction']): Prisma.RoleOrderByWithRelationInput {
  if (sort === 'name') return { name: direction };
  return { code: direction };
}

function assertOptionalRouteFilter(value: string | undefined, expected: string): void {
  if (value !== undefined && value !== expected) throw resourceNotFound();
}

function accessConflict(): SafeHttpException {
  return new SafeHttpException(
    HttpStatus.CONFLICT,
    'ACCESS_VERSION_CONFLICT',
    '访问权限已发生变化，请刷新后重试',
  );
}

function invalidAccessRequest(field: string, code: string): SafeHttpException {
  return new SafeHttpException(
    HttpStatus.BAD_REQUEST,
    'INVALID_REQUEST',
    '请检查访问授权内容',
    [{ field, code }],
  );
}

function roleCode(value: string): Role {
  if (!isRole(value)) throw new Error('Database contains an unsupported role code');
  return value;
}

function normalizeAssignment(
  assignment: ReplaceUserAccessRequest['assignments'][number],
  assignmentIndex: number,
  facilityId: string,
) {
  const activeFrom = assignment.activeFrom === undefined ? new Date() : new Date(assignment.activeFrom);
  const expiresAt = assignment.expiresAt === undefined ? null : new Date(assignment.expiresAt);
  if (expiresAt !== null && expiresAt <= activeFrom) {
    throw invalidAccessRequest(`assignments.${assignmentIndex}.expiresAt`, 'TIME_RANGE_INVALID');
  }
  const scopes = assignment.scopes.map((scope, scopeIndex) => {
    const field = `assignments.${assignmentIndex}.scopes.${scopeIndex}`;
    if (!['FACILITY', 'ACTIVE_SHIFT', 'OWN_RECORD'].includes(scope.kind)) {
      throw invalidAccessRequest(`${field}.kind`, 'SCOPE_KIND_UNSUPPORTED');
    }
    if (scope.kind === 'OWN_RECORD') {
      if (scope.facilityId !== undefined || scope.resourceType !== undefined || scope.resourceId !== undefined) {
        throw invalidAccessRequest(field, 'SCOPE_SHAPE_INVALID');
      }
      if (scope.scopeKey !== 'own-record') {
        throw invalidAccessRequest(`${field}.scopeKey`, 'SCOPE_KEY_INVALID');
      }
    } else if (scope.facilityId !== facilityId) {
      throw invalidAccessRequest(`${field}.facilityId`, 'FACILITY_SCOPE_MISMATCH');
    } else if (
      scope.kind === 'FACILITY' &&
      scope.scopeKey !== `facility:${facilityId}`
    ) {
      throw invalidAccessRequest(`${field}.scopeKey`, 'SCOPE_KEY_INVALID');
    }
    const validFrom = scope.validFrom === undefined ? activeFrom : new Date(scope.validFrom);
    const validUntil = scope.validUntil === undefined ? expiresAt : new Date(scope.validUntil);
    if (validUntil !== null && validUntil <= validFrom) {
      throw invalidAccessRequest(`${field}.validUntil`, 'TIME_RANGE_INVALID');
    }
    if (validFrom < activeFrom || (expiresAt !== null && (validUntil === null || validUntil > expiresAt))) {
      throw invalidAccessRequest(field, 'SCOPE_OUTSIDE_ASSIGNMENT_WINDOW');
    }
    if (scope.kind === 'ACTIVE_SHIFT' && validUntil === null) {
      throw invalidAccessRequest(`${field}.validUntil`, 'ACTIVE_SHIFT_MUST_EXPIRE');
    }
    return {
      kind: scope.kind as 'ACTIVE_SHIFT' | 'FACILITY' | 'OWN_RECORD',
      scopeKey: scope.scopeKey,
      facilityId: scope.kind === 'OWN_RECORD' ? null : facilityId,
      validFrom,
      validUntil,
    };
  });
  if (new Set(scopes.map((scope) => scope.scopeKey)).size !== scopes.length) {
    throw invalidAccessRequest(`assignments.${assignmentIndex}.scopes`, 'SCOPE_KEY_DUPLICATE');
  }
  if (!scopes.some((scope) => scope.kind === 'FACILITY' || scope.kind === 'ACTIVE_SHIFT')) {
    throw invalidAccessRequest(`assignments.${assignmentIndex}.scopes`, 'FACILITY_CONTEXT_REQUIRED');
  }
  return { roleId: assignment.roleId, activeFrom, expiresAt, scopes };
}

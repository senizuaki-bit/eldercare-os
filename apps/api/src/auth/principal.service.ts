import { Inject, Injectable } from '@nestjs/common';
import { isRole, type Role } from '@eldercare/authz';
import type { Prisma } from '@eldercare/db';
import type {
  AuthContextSummary,
  AuthenticatedPrincipal,
  AuthRoleSummary,
  PortalKind,
} from './auth.types.js';
import { DatabaseService } from '../database/database.service.js';

const assignmentInclude = {
  organization: true,
  role: {
    include: {
      rolePermissions: { include: { permission: true } },
    },
  },
  dataScopes: { include: { facility: true } },
} satisfies Prisma.UserRoleInclude;

type Assignment = Prisma.UserRoleGetPayload<{ include: typeof assignmentInclude }>;

@Injectable()
export class PrincipalService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async selectInitialContext(userId: string, expiresAt: Date): Promise<{
    readonly organizationId: string;
    readonly facilityId: string | null;
    readonly principal: AuthenticatedPrincipal;
  } | undefined> {
    const snapshot = await this.loadSnapshot(userId);
    if (snapshot === undefined || snapshot.contexts.length === 0) return undefined;
    const context = snapshot.contexts[0];
    if (context === undefined) return undefined;
    const principal = this.createPrincipal(snapshot, context, expiresAt);
    return {
      organizationId: context.organizationId,
      facilityId: context.facilityId,
      principal,
    };
  }

  async buildForContext(
    userId: string,
    organizationId: string,
    facilityId: string | null,
    expiresAt: Date,
  ): Promise<AuthenticatedPrincipal | undefined> {
    const snapshot = await this.loadSnapshot(userId);
    if (snapshot === undefined) return undefined;
    const context = snapshot.contexts.find(
      (candidate) =>
        candidate.organizationId === organizationId && candidate.facilityId === facilityId,
    );
    return context === undefined ? undefined : this.createPrincipal(snapshot, context, expiresAt);
  }

  private async loadSnapshot(userId: string): Promise<PrincipalSnapshot | undefined> {
    const now = new Date();
    const [user, assignments] = await Promise.all([
      this.database.client.user.findUnique({ where: { id: userId } }),
      this.database.client.userRole.findMany({
        where: {
          userId,
          organization: { status: 'ACTIVE' },
          activeFrom: { lte: now },
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        include: assignmentInclude,
        orderBy: [{ organization: { name: 'asc' } }, { role: { code: 'asc' } }],
      }),
    ]);
    if (user === null || user.status !== 'ACTIVE' || assignments.length === 0) return undefined;

    const contexts = await this.deriveContexts(assignments, now);
    return { assignments, contexts, user };
  }

  private async deriveContexts(
    assignments: readonly Assignment[],
    now: Date,
  ): Promise<AuthContextSummary[]> {
    const hasPlatformScope = assignments.some((assignment) =>
      assignment.dataScopes.some(
        (scope) => scope.kind === 'PLATFORM' && scopeIsActive(scope.validFrom, scope.validUntil, now),
      ),
    );
    if (hasPlatformScope) {
      const facilities = await this.database.client.facility.findMany({
        where: { status: 'ACTIVE', organization: { status: 'ACTIVE' } },
        include: { organization: true },
        orderBy: [{ organization: { name: 'asc' } }, { name: 'asc' }],
      });
      return facilities.map((facility) => ({
        organizationId: facility.organizationId,
        organizationName: facility.organization.name,
        facilityId: facility.id,
        facilityName: facility.name,
      }));
    }

    const contexts = new Map<string, AuthContextSummary>();
    for (const assignment of assignments) {
      const activeScopes = assignment.dataScopes.filter((scope) =>
        scopeIsActive(scope.validFrom, scope.validUntil, now),
      );
      let addedFacilityContext = false;
      for (const scope of activeScopes) {
        if (scope.kind === 'ORGANIZATION') {
          const facilities = await this.database.client.facility.findMany({
            where: { organizationId: assignment.organizationId, status: 'ACTIVE' },
            orderBy: { name: 'asc' },
          });
          if (facilities.length === 0) {
            contexts.set(`${assignment.organizationId}:`, {
              organizationId: assignment.organizationId,
              organizationName: assignment.organization.name,
              facilityId: null,
              facilityName: null,
            });
          }
          for (const facility of facilities) {
            addedFacilityContext = true;
            contexts.set(`${assignment.organizationId}:${facility.id}`, {
              organizationId: assignment.organizationId,
              organizationName: assignment.organization.name,
              facilityId: facility.id,
              facilityName: facility.name,
            });
          }
        }
        if (
          scope.facility !== null &&
          scope.facility.status === 'ACTIVE' &&
          ['FACILITY', 'FLOOR', 'CARE_TEAM', 'ASSIGNED_ELDER', 'ACTIVE_SHIFT', 'LINKED_ELDER'].includes(scope.kind)
        ) {
          addedFacilityContext = true;
          contexts.set(`${assignment.organizationId}:${scope.facility.id}`, {
            organizationId: assignment.organizationId,
            organizationName: assignment.organization.name,
            facilityId: scope.facility.id,
            facilityName: scope.facility.name,
          });
        }
      }
      if (
        !addedFacilityContext &&
        activeScopes.some((scope) => scope.kind === 'OWN_RECORD')
      ) {
        contexts.set(`${assignment.organizationId}:`, {
          organizationId: assignment.organizationId,
          organizationName: assignment.organization.name,
          facilityId: null,
          facilityName: null,
        });
      }
    }
    return [...contexts.values()].sort((left, right) =>
      `${left.organizationName}:${left.facilityName ?? ''}`.localeCompare(
        `${right.organizationName}:${right.facilityName ?? ''}`,
        'zh-CN',
      ),
    );
  }

  private createPrincipal(
    snapshot: PrincipalSnapshot,
    context: AuthContextSummary,
    expiresAt: Date,
  ): AuthenticatedPrincipal {
    const assignments = snapshot.assignments.filter((assignment) =>
      assignmentAppliesToContext(assignment, context, new Date()),
    );
    const rolesByKey = new Map<string, AuthRoleSummary>();
    const permissions = new Set<string>();
    for (const assignment of assignments) {
      if (!isRole(assignment.role.code)) {
        throw new Error('Database contains an unsupported role code');
      }
      rolesByKey.set(assignment.role.code, {
        key: assignment.role.code,
        label: assignment.role.name,
      });
      for (const rolePermission of assignment.role.rolePermissions) {
        permissions.add(rolePermission.permission.code);
      }
    }
    const roles = [...rolesByKey.values()].sort((left, right) => left.key.localeCompare(right.key));

    return {
      user: {
        id: snapshot.user.id,
        username: snapshot.user.loginName,
        displayName: snapshot.user.displayName,
      },
      activeContext: context,
      availableContexts: [...snapshot.contexts],
      roles,
      permissions: [...permissions].sort(),
      portal: derivePortal(roles.map((role) => role.key)),
      expiresAt: expiresAt.toISOString(),
    };
  }
}

interface PrincipalSnapshot {
  readonly user: {
    readonly id: string;
    readonly loginName: string;
    readonly displayName: string;
  };
  readonly assignments: readonly Assignment[];
  readonly contexts: readonly AuthContextSummary[];
}

function scopeIsActive(validFrom: Date, validUntil: Date | null, now: Date): boolean {
  return validFrom <= now && (validUntil === null || validUntil > now);
}

function assignmentAppliesToContext(
  assignment: Assignment,
  context: AuthContextSummary,
  now: Date,
): boolean {
  return assignment.dataScopes.some((scope) => {
    if (!scopeIsActive(scope.validFrom, scope.validUntil, now)) return false;
    if (scope.kind === 'PLATFORM') return true;
    if (scope.organizationId !== context.organizationId) return false;
    if (scope.kind === 'ORGANIZATION') return true;
    if (scope.kind === 'OWN_RECORD') return context.facilityId === null;
    return (
      scope.facilityId === context.facilityId &&
      ['FACILITY', 'FLOOR', 'CARE_TEAM', 'ASSIGNED_ELDER', 'ACTIVE_SHIFT', 'LINKED_ELDER'].includes(scope.kind)
    );
  });
}

function derivePortal(roleKeys: readonly Role[]): PortalKind {
  if (roleKeys.includes('ELDER')) return 'elder';
  if (roleKeys.includes('FAMILY')) return 'family';
  if (roleKeys.includes('CAREGIVER')) return 'caregiver';
  return 'admin';
}

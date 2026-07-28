import type { Prisma } from '@eldercare/db';

import type { M03FacilityContext } from './m03-context.service.js';

export function activeElderRoleWhere(
  context: M03FacilityContext,
  userId: string,
  now: Date,
  requiredPermission: string,
): Prisma.UserRoleWhereInput {
  return {
    userId,
    organizationId: context.organizationId,
    user: { status: 'ACTIVE' },
    organization: { status: 'ACTIVE' },
    activeFrom: { lte: now },
    revokedAt: null,
    role: {
      code: 'ELDER',
      rolePermissions: {
        some: { permission: { code: requiredPermission } },
      },
    },
    AND: [
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      {
        dataScopes: {
          some: {
            organizationId: context.organizationId,
            kind: 'OWN_RECORD',
            validFrom: { lte: now },
            AND: [
              { OR: [{ facilityId: null }, { facilityId: context.facilityId }] },
              { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
            ],
          },
        },
      },
    ],
  };
}

export async function hasActiveElderOwnedAccess(
  tx: Prisma.TransactionClient,
  context: M03FacilityContext,
  elderId: string,
  userId: string,
  now: Date,
  requiredPermission: string,
): Promise<boolean> {
  const [facility, elder, role] = await Promise.all([
    tx.facility.findFirst({
      where: {
        id: context.facilityId,
        organizationId: context.organizationId,
        status: 'ACTIVE',
        organization: { status: 'ACTIVE' },
      },
      select: { id: true },
    }),
    tx.elder.findFirst({
      where: {
        id: elderId,
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        portalUserId: userId,
        status: 'ACTIVE',
        stays: {
          some: {
            organizationId: context.organizationId,
            facilityId: context.facilityId,
            status: 'ACTIVE',
            admittedAt: { lte: now },
            OR: [{ dischargedAt: null }, { dischargedAt: { gt: now } }],
          },
        },
      },
      select: { id: true },
    }),
    tx.userRole.findFirst({
      where: activeElderRoleWhere(context, userId, now, requiredPermission),
      select: { id: true },
    }),
  ]);
  return facility !== null && elder !== null && role !== null;
}

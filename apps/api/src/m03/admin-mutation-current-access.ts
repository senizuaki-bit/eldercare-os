import type { M03_PERMISSIONS } from '@eldercare/authz';
import type { Prisma } from '@eldercare/db';

import type { M03FacilityContext } from './m03-context.service.js';

export type AdminWorkOrderMutationPermission =
  | typeof M03_PERMISSIONS.WORK_ORDER_ASSIGN
  | typeof M03_PERMISSIONS.WORK_ORDER_VERIFY
  | typeof M03_PERMISSIONS.WORK_ORDER_CLOSE
  | typeof M03_PERMISSIONS.AI_ANALYSIS_READ
  | typeof M03_PERMISSIONS.FAMILY_SUMMARY_PUBLISH;

export function currentAdminWorkOrderMutationRoleWhere(
  context: M03FacilityContext,
  userId: string,
  requiredPermissions: readonly AdminWorkOrderMutationPermission[],
  now: Date,
): Prisma.UserRoleWhereInput {
  return {
    userId,
    user: { status: 'ACTIVE' },
    organization: { status: 'ACTIVE' },
    activeFrom: { lte: now },
    revokedAt: null,
    AND: [
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      ...requiredPermissions.map((permission) => ({
        role: { rolePermissions: { some: { permission: { code: permission } } } },
      })),
      {
        dataScopes: {
          some: {
            validFrom: { lte: now },
            AND: [
              { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
              {
                OR: [
                  { kind: 'PLATFORM' },
                  { kind: 'ORGANIZATION', organizationId: context.organizationId },
                  { kind: 'FACILITY', organizationId: context.organizationId, facilityId: context.facilityId },
                ],
              },
            ],
          },
        },
      },
    ],
  };
}

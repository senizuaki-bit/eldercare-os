import { Inject, Injectable } from '@nestjs/common';
import { M03_PERMISSIONS } from '@eldercare/authz';

import type { AuthenticatedSession } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';
import type { M02FacilityContext } from '../m02/m02-context.js';

@Injectable()
export class AdminCurrentAccessService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async canReadFacilityWorkOrders(
    context: M02FacilityContext,
    session: AuthenticatedSession,
  ): Promise<boolean> {
    const now = new Date();
    const currentFacility = await this.database.client.facility.findFirst({
      where: {
        id: context.facilityId,
        organizationId: context.organizationId,
        status: 'ACTIVE',
        organization: { status: 'ACTIVE' },
      },
      select: { id: true },
    });
    if (currentFacility === null) return false;

    const currentUser = await this.database.client.user.findFirst({
      where: {
        id: session.userId,
        status: 'ACTIVE',
        userRoles: {
          some: {
            activeFrom: { lte: now },
            revokedAt: null,
            role: {
              rolePermissions: {
                some: {
                  permission: { code: M03_PERMISSIONS.WORK_ORDER_READ },
                },
              },
            },
            AND: [
              { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
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
                          {
                            kind: 'FACILITY',
                            organizationId: context.organizationId,
                            facilityId: context.facilityId,
                          },
                        ],
                      },
                    ],
                  },
                },
              },
            ],
          },
        },
      },
      select: { id: true },
    });
    return currentUser !== null;
  }
}

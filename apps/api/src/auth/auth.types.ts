import type { Request } from 'express';
import type { Role } from '@eldercare/authz';

export type PortalKind = 'admin' | 'caregiver' | 'elder' | 'family';

export interface AuthRoleSummary {
  readonly key: Role;
  readonly label: string;
}

export interface AuthContextSummary {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly facilityId: string | null;
  readonly facilityName: string | null;
}

export interface AuthenticatedPrincipal {
  readonly user: {
    readonly id: string;
    readonly username: string;
    readonly displayName: string;
  };
  readonly activeContext: AuthContextSummary;
  readonly availableContexts: AuthContextSummary[];
  readonly roles: AuthRoleSummary[];
  readonly permissions: string[];
  readonly portal: PortalKind;
  readonly expiresAt: string;
}

export interface AuthenticatedSession {
  readonly id: string;
  readonly userId: string;
  readonly csrfTokenHash: string;
  readonly tokenHash: string;
  readonly principal: AuthenticatedPrincipal;
}

export type AuthenticatedRequest = Request & {
  auth?: AuthenticatedSession;
  correlationId?: string;
};

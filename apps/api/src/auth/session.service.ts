import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ServiceConfig } from '@eldercare/config';
import type { Prisma, PrismaClient } from '@eldercare/db';
import { AuditService } from '../audit/audit.service.js';
import { DatabaseService } from '../database/database.service.js';
import { SERVICE_CONFIG } from '../tokens.js';
import type { AuthenticatedPrincipal, AuthenticatedSession } from './auth.types.js';
import { PrincipalService } from './principal.service.js';

type SessionClient = Pick<PrismaClient, 'authSession'> | Prisma.TransactionClient;

export interface CreatedSession {
  readonly session: AuthenticatedSession;
  readonly sessionToken: string;
  readonly csrfToken: string;
}

@Injectable()
export class SessionService {
  readonly productionCookies: boolean;
  readonly cookieMaxAgeSeconds: number;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PrincipalService) private readonly principals: PrincipalService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SERVICE_CONFIG) private readonly config: ServiceConfig,
  ) {
    this.productionCookies = config.nodeEnv === 'production';
    this.cookieMaxAgeSeconds = config.authSessionAbsoluteTtlSeconds;
  }

  async create(userId: string, sessionVersion: number): Promise<CreatedSession | undefined> {
    const now = new Date();
    const absoluteExpiresAt = new Date(
      now.getTime() + this.config.authSessionAbsoluteTtlSeconds * 1_000,
    );
    const selected = await this.principals.selectInitialContext(userId, absoluteExpiresAt);
    if (selected === undefined) return undefined;

    const sessionToken = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const idleExpiresAt = minDate(
      new Date(now.getTime() + this.config.authSessionIdleTtlSeconds * 1_000),
      absoluteExpiresAt,
    );
    const record = await this.database.client.authSession.create({
      data: {
        userId,
        organizationId: selected.organizationId,
        facilityId: selected.facilityId,
        tokenHash: hashToken(sessionToken),
        csrfTokenHash: hashToken(csrfToken),
        sessionVersion,
        lastSeenAt: now,
        idleExpiresAt,
        absoluteExpiresAt,
      },
    });
    const principal = await this.principals.buildForContext(
      userId,
      selected.organizationId,
      selected.facilityId,
      idleExpiresAt,
    );
    if (principal === undefined) {
      await this.revoke(record.id, 'CONTEXT_UNAVAILABLE');
      return undefined;
    }

    return {
      sessionToken,
      csrfToken,
      session: toAuthenticatedSession(record, principal),
    };
  }

  async resolve(rawToken: string): Promise<AuthenticatedSession | undefined> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return undefined;
    const now = new Date();
    const tokenHash = hashToken(rawToken);
    const record = await this.database.client.authSession.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (record === null) return undefined;
    const invalidReason =
      record.revokedAt !== null
        ? 'REVOKED'
        : record.user.status !== 'ACTIVE'
          ? 'USER_INACTIVE'
          : record.sessionVersion !== record.user.sessionVersion
            ? 'SESSION_VERSION_CHANGED'
            : record.idleExpiresAt <= now
              ? 'IDLE_EXPIRED'
              : record.absoluteExpiresAt <= now
                ? 'ABSOLUTE_EXPIRED'
                : undefined;
    if (invalidReason !== undefined) {
      if (record.revokedAt === null) await this.revoke(record.id, invalidReason);
      return undefined;
    }

    const idleExpiresAt = minDate(
      new Date(now.getTime() + this.config.authSessionIdleTtlSeconds * 1_000),
      record.absoluteExpiresAt,
    );
    const principal = await this.principals.buildForContext(
      record.userId,
      record.organizationId,
      record.facilityId,
      idleExpiresAt,
    );
    if (principal === undefined) {
      await this.revoke(record.id, 'ACCESS_CONTEXT_CHANGED');
      return undefined;
    }

    const refreshed = await this.database.client.authSession.updateMany({
      where: {
        id: record.id,
        userId: record.userId,
        tokenHash,
        revokedAt: null,
        sessionVersion: record.sessionVersion,
        idleExpiresAt: { gt: now },
        absoluteExpiresAt: { gt: now },
        user: { status: 'ACTIVE', sessionVersion: record.sessionVersion },
      },
      data: { lastSeenAt: now, idleExpiresAt },
    });
    if (refreshed.count !== 1) return undefined;
    return toAuthenticatedSession(record, principal);
  }

  async switchContext(
    session: AuthenticatedSession,
    organizationId: string,
    facilityId: string | null,
    correlationId: string,
  ): Promise<AuthenticatedPrincipal | undefined> {
    const expiresAt = new Date(session.principal.expiresAt);
    const principal = await this.principals.buildForContext(
      session.userId,
      organizationId,
      facilityId,
      expiresAt,
    );
    if (principal === undefined) return undefined;
    const updated = await this.database.client.$transaction(async (transaction) => {
      const result = await transaction.authSession.updateMany({
        where: {
          id: session.id,
          userId: session.userId,
          tokenHash: session.tokenHash,
          revokedAt: null,
        },
        data: { organizationId, facilityId },
      });
      if (result.count !== 1) return false;
      await this.audit.record(
        {
          organizationId,
          facilityId,
          actorUserId: session.userId,
          actorType: 'USER',
          action: 'AUTH.CONTEXT_SWITCHED',
          outcome: 'SUCCESS',
          resourceType: 'AUTH_SESSION',
          resourceId: session.id,
          correlationId,
          metadata: {
            contextChanged: true,
            targetOrganizationId: organizationId,
            targetFacilityId: facilityId,
          },
        },
        transaction,
      );
      return true;
    });
    return updated ? principal : undefined;
  }

  async revoke(id: string, reason: string, client: SessionClient = this.database.client): Promise<void> {
    await client.authSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason.slice(0, 96) },
    });
  }

  async revokeAllForUser(
    userId: string,
    reason: string,
    client: SessionClient = this.database.client,
  ): Promise<void> {
    await client.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason.slice(0, 96) },
    });
  }

  matchesCsrfToken(expectedHash: string, token: string): boolean {
    const actualHash = hashToken(token);
    const expected = Buffer.from(expectedHash, 'hex');
    const actual = Buffer.from(actualHash, 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}

function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function minDate(left: Date, right: Date): Date {
  return left <= right ? left : right;
}

function toAuthenticatedSession(
  record: {
    readonly id: string;
    readonly userId: string;
    readonly tokenHash: string;
    readonly csrfTokenHash: string;
  },
  principal: AuthenticatedPrincipal,
): AuthenticatedSession {
  return {
    id: record.id,
    userId: record.userId,
    tokenHash: record.tokenHash,
    csrfTokenHash: record.csrfTokenHash,
    principal,
  };
}

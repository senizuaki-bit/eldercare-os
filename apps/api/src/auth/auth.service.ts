import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { LoginRequest } from '@eldercare/contracts';
import { AuditService } from '../audit/audit.service.js';
import { SafeHttpException } from '../common/safe-http.exception.js';
import { DatabaseService } from '../database/database.service.js';
import { AuthRateLimiterService, type LoginRateLimitDecision } from './auth-rate-limiter.service.js';
import type { CreatedSession } from './session.service.js';
import { SessionService } from './session.service.js';
import { CredentialService } from './credential.service.js';

export interface LoginAttemptContext {
  readonly correlationId: string;
  readonly remoteAddress: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CredentialService) private readonly credentials: CredentialService,
    @Inject(AuthRateLimiterService) private readonly rateLimiter: AuthRateLimiterService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async login(input: LoginRequest, context: LoginAttemptContext): Promise<{
    readonly created: CreatedSession;
    readonly rateLimit: LoginRateLimitDecision;
  }> {
    const normalizedLoginName = this.credentials.normalizeLoginName(input.loginName);
    let rateLimit: LoginRateLimitDecision;
    try {
      rateLimit = await this.rateLimiter.consume(normalizedLoginName, context.remoteAddress);
    } catch {
      throw new SafeHttpException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'AUTH_SERVICE_UNAVAILABLE',
        '登录服务暂时不可用，请稍后再试',
      );
    }
    if (!rateLimit.allowed) {
      await this.auditAnonymousFailure('AUTH.LOGIN_RATE_LIMITED', 'RATE_LIMITED', context.correlationId);
      throw new SafeHttpException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        '尝试次数过多，请稍后再试',
      );
    }

    const user = await this.database.client.user.findUnique({
      where: { normalizedLoginName },
      include: { passwordCredential: true, userRoles: { where: { revokedAt: null }, take: 1 } },
    });
    const now = new Date();
    const credentialLocked =
      user?.passwordCredential?.lockedUntil !== null &&
      user?.passwordCredential?.lockedUntil !== undefined &&
      user.passwordCredential.lockedUntil > now;
    const valid = await this.credentials.verify(
      input.password,
      user?.passwordCredential?.passwordHash,
    );

    if (user === null || user.status !== 'ACTIVE' || credentialLocked || !valid) {
      if (user?.passwordCredential !== null && user?.passwordCredential !== undefined && !credentialLocked) {
        await this.recordCredentialFailure(user.id, user.passwordCredential.failedLoginCount);
      }
      await this.auditLoginFailure(user, 'INVALID_CREDENTIALS', context.correlationId);
      throw invalidCredentialsError();
    }

    const created = await this.sessions.create(user.id, user.sessionVersion);
    if (created === undefined) {
      await this.auditLoginFailure(user, 'NO_ACTIVE_ACCESS', context.correlationId);
      throw invalidCredentialsError();
    }

    await this.database.client.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id: user.id },
        data: { lastLoginAt: now },
      });
      await transaction.passwordCredential.update({
        where: { userId: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
      await this.audit.record(
        {
          organizationId: created.session.principal.activeContext.organizationId,
          facilityId: created.session.principal.activeContext.facilityId,
          actorUserId: user.id,
          actorType: 'USER',
          action: 'AUTH.LOGIN_SUCCEEDED',
          outcome: 'SUCCESS',
          resourceType: 'AUTH_SESSION',
          resourceId: created.session.id,
          correlationId: context.correlationId,
        },
        transaction,
      );
    });
    await this.rateLimiter.resetAccount(normalizedLoginName).catch(() => undefined);
    return { created, rateLimit };
  }

  private async recordCredentialFailure(userId: string, currentCount: number): Promise<void> {
    const failedLoginCount = currentCount + 1;
    await this.database.client.passwordCredential.update({
      where: { userId },
      data: { failedLoginCount },
    });
  }

  private async auditLoginFailure(
    user: { readonly id: string; readonly userRoles: readonly { organizationId: string }[] } | null,
    reasonCode: string,
    correlationId: string,
  ): Promise<void> {
    const organizationId =
      user?.userRoles[0]?.organizationId ?? (await this.getPlatformAuditOrganizationId());
    await this.audit.record({
      organizationId,
      actorType: 'ANONYMOUS',
      action: 'AUTH.LOGIN_FAILED',
      outcome: 'FAILURE',
      resourceType: 'AUTH_SESSION',
      reasonCode,
      correlationId,
    });
  }

  private async auditAnonymousFailure(
    action: string,
    reasonCode: string,
    correlationId: string,
  ): Promise<void> {
    await this.audit.record({
      organizationId: await this.getPlatformAuditOrganizationId(),
      actorType: 'ANONYMOUS',
      action,
      outcome: 'DENIED',
      resourceType: 'AUTH_SESSION',
      reasonCode,
      correlationId,
    });
  }

  private async getPlatformAuditOrganizationId(): Promise<string> {
    const organization = await this.database.client.organization.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { slug: 'asc' },
      select: { id: true },
    });
    if (organization === null) {
      throw new SafeHttpException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'AUTH_SERVICE_UNAVAILABLE',
        '登录服务暂时不可用，请稍后再试',
      );
    }
    return organization.id;
  }
}

function invalidCredentialsError(): SafeHttpException {
  return new SafeHttpException(
    HttpStatus.UNAUTHORIZED,
    'INVALID_CREDENTIALS',
    '账号或密码不正确',
  );
}

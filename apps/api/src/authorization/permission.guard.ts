import { CanActivate, HttpStatus, Inject, Injectable, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditService } from '../audit/audit.service.js';
import { REQUIRED_PERMISSIONS } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { SafeHttpException } from '../common/safe-http.exception.js';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<readonly string[]>(REQUIRED_PERMISSIONS, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required === undefined || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const auth = request.auth;
    if (auth !== undefined && required.every((permission) => auth.principal.permissions.includes(permission))) {
      return true;
    }

    if (auth !== undefined) {
      await this.audit.record({
        organizationId: auth.principal.activeContext.organizationId,
        facilityId: auth.principal.activeContext.facilityId,
        actorUserId: auth.userId,
        actorType: 'USER',
        action: 'SECURITY.ACCESS_DENIED',
        outcome: 'DENIED',
        resourceType: 'API_PERMISSION',
        reasonCode: 'PERMISSION_MISSING',
        correlationId: request.correlationId ?? 'unknown-correlation',
      });
    }

    throw new SafeHttpException(
      HttpStatus.FORBIDDEN,
      'FORBIDDEN',
      '当前身份无权执行此操作',
    );
  }
}

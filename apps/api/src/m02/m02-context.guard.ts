import {
  CanActivate,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { SafeHttpException } from '../common/safe-http.exception.js';
import { M02ContextService } from './m02-context.js';

export const M02_CONTEXT_ROUTE = 'm02.contextRoute';
export const M02ContextRoute = () => SetMetadata(M02_CONTEXT_ROUTE, true);

/**
 * Runs the canonical M02 context boundary before CSRF and permission guards so
 * non-admin callers receive the same non-enumerating response for every method.
 * The authorization decision itself remains in M02ContextService.
 */
@Injectable()
export class M02ContextGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(M02ContextService) private readonly m02Context: M02ContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const usesM02Context = this.reflector.getAllAndOverride<boolean>(M02_CONTEXT_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (usesM02Context !== true) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const session = request.auth;
    if (session === undefined) {
      throw new SafeHttpException(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
        '登录状态无效或已过期。',
      );
    }
    const organizationId = request.params['organizationId'];
    const facilityId = request.params['facilityId'];
    await this.m02Context.assertFacility(
      typeof organizationId === 'string' ? organizationId : '',
      typeof facilityId === 'string' ? facilityId : '',
      session,
      request,
    );
    return true;
  }
}

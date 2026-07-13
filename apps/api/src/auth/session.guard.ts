import { CanActivate, HttpStatus, Inject, Injectable, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SafeHttpException } from '../common/safe-http.exception.js';
import { PUBLIC_ROUTE } from './auth.decorators.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { getAuthCookieNames, readCookie } from './cookies.js';
import { SessionService } from './session.service.js';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const names = getAuthCookieNames(this.sessions.productionCookies);
    const rawToken = readCookie(request.header('cookie'), names.session);
    const session = rawToken === undefined ? undefined : await this.sessions.resolve(rawToken);
    if (session === undefined) {
      throw new SafeHttpException(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
        '登录状态无效或已过期',
      );
    }

    request.auth = session;
    return true;
  }
}

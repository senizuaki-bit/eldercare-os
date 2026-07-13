import { timingSafeEqual } from 'node:crypto';
import { CanActivate, HttpStatus, Inject, Injectable, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ServiceConfig } from '@eldercare/config';
import { SafeHttpException } from '../common/safe-http.exception.js';
import { SERVICE_CONFIG } from '../tokens.js';
import { SKIP_CSRF_TOKEN } from './auth.decorators.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { getAuthCookieNames, readCookie } from './cookies.js';
import { SessionService } from './session.service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(SERVICE_CONFIG) private readonly config: ServiceConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (SAFE_METHODS.has(request.method.toUpperCase())) return true;

    const origin = request.header('origin');
    if (origin === undefined || !this.config.corsOrigins.includes(origin)) {
      throw csrfError();
    }

    const skipToken = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_TOKEN, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skipToken) return true;

    const auth = request.auth;
    if (auth === undefined) throw csrfError();
    const names = getAuthCookieNames(this.sessions.productionCookies);
    const cookieToken = readCookie(request.header('cookie'), names.csrf);
    const headerToken = request.header('x-csrf-token');
    if (
      cookieToken === undefined ||
      headerToken === undefined ||
      !constantTimeStringEqual(cookieToken, headerToken) ||
      !this.sessions.matchesCsrfToken(auth.csrfTokenHash, headerToken)
    ) {
      throw csrfError();
    }

    return true;
  }
}

function csrfError(): SafeHttpException {
  return new SafeHttpException(HttpStatus.FORBIDDEN, 'CSRF_INVALID', '安全校验失败，请刷新后重试');
}

function constantTimeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

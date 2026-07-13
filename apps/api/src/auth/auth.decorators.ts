import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedPrincipal, AuthenticatedRequest, AuthenticatedSession } from './auth.types.js';

export const PUBLIC_ROUTE = 'auth.public';
export const REQUIRED_PERMISSIONS = 'auth.requiredPermissions';
export const SKIP_CSRF_TOKEN = 'auth.skipCsrfToken';

export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const SkipCsrfToken = () => SetMetadata(SKIP_CSRF_TOKEN, true);
export const RequirePermissions = (...permissions: readonly string[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedSession => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.auth === undefined) {
      throw new Error('Authenticated session is unavailable');
    }
    return request.auth;
  },
);

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedPrincipal => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.auth === undefined) {
      throw new Error('Authenticated principal is unavailable');
    }
    return request.auth.principal;
  },
);

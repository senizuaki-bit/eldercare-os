import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  loginRequestSchema,
  switchContextRequestSchema,
  type SessionContext,
} from '@eldercare/contracts';
import type { Request, Response } from 'express';
import { AuditService } from '../audit/audit.service.js';
import { parseSchema } from '../common/parse-schema.js';
import { SafeHttpException } from '../common/safe-http.exception.js';
import {
  CurrentSession,
  Public,
  SkipCsrfToken,
} from './auth.decorators.js';
import {
  LoginRequestDto,
  LogoutResponseDto,
  SessionContextDto,
  SwitchContextRequestDto,
} from './auth.dto.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest, AuthenticatedSession } from './auth.types.js';
import { clearAuthCookies, setAuthCookies } from './cookies.js';
import { SessionService } from './session.service.js';

@ApiTags('authentication')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Post('login')
  @Public()
  @SkipCsrfToken()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create a local-demo password session' })
  @ApiBody({ type: LoginRequestDto })
  @ApiOkResponse({ type: SessionContextDto })
  @ApiBadRequestResponse({ description: 'The request body is invalid.' })
  @ApiUnauthorizedResponse({ description: 'Credentials are invalid without account enumeration.' })
  @ApiResponse({ status: 429, description: 'The login rate limit was exceeded.' })
  async login(
    @Body() body: LoginRequestDto,
    @Req() request: Request & { correlationId?: string },
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionContext> {
    const input = parseSchema(loginRequestSchema, body);
    try {
      const result = await this.auth.login(input, {
        correlationId: request.correlationId ?? 'unknown-correlation',
        remoteAddress: request.socket.remoteAddress ?? 'unknown',
      });
      setAuthCookies(
        response,
        result.created.sessionToken,
        result.created.csrfToken,
        {
          production: this.sessions.productionCookies,
          maxAgeSeconds: this.sessions.cookieMaxAgeSeconds,
        },
      );
      return result.created.session.principal;
    } catch (error) {
      if (error instanceof SafeHttpException && error.getStatus() === 429) {
        response.setHeader('Retry-After', '60');
      }
      throw error;
    }
  }

  @Get('session')
  @ApiCookieAuth('sessionCookie')
  @ApiOperation({ summary: 'Read the current server-authorized session context' })
  @ApiOkResponse({ type: SessionContextDto })
  @ApiUnauthorizedResponse({ description: 'The session is missing, expired or revoked.' })
  session(@CurrentSession() session: AuthenticatedSession, @Res({ passthrough: true }) response: Response): SessionContext {
    response.setHeader('Cache-Control', 'no-store');
    return session.principal;
  }

  @Post('context')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('sessionCookie')
  @ApiSecurity('csrf')
  @ApiOperation({ summary: 'Switch to a server-validated organization/facility context' })
  @ApiBody({ type: SwitchContextRequestDto })
  @ApiOkResponse({ type: SessionContextDto })
  @ApiForbiddenResponse({ description: 'The requested context is outside the session scope.' })
  async switchContext(
    @Body() body: SwitchContextRequestDto,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionContext> {
    const input = parseSchema(switchContextRequestSchema, body);
    const principal = await this.sessions.switchContext(
      session,
      input.organizationId,
      input.facilityId,
      request.correlationId ?? 'unknown-correlation',
    );
    if (principal === undefined) {
      throw new SafeHttpException(
        HttpStatus.NOT_FOUND,
        'RESOURCE_NOT_FOUND',
        '记录不存在或不可访问',
      );
    }
    response.setHeader('Cache-Control', 'no-store');
    return principal;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('sessionCookie')
  @ApiSecurity('csrf')
  @ApiOperation({ summary: 'Revoke the current session and clear cookies' })
  @ApiOkResponse({ type: LogoutResponseDto })
  async logout(
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ loggedOut: true }> {
    await this.sessions.revoke(session.id, 'USER_LOGOUT');
    await this.audit.record({
      organizationId: session.principal.activeContext.organizationId,
      facilityId: session.principal.activeContext.facilityId,
      actorUserId: session.userId,
      actorType: 'USER',
      action: 'AUTH.LOGOUT',
      outcome: 'SUCCESS',
      resourceType: 'AUTH_SESSION',
      resourceId: session.id,
      correlationId: request.correlationId ?? 'unknown-correlation',
    });
    clearAuthCookies(response, this.sessions.productionCookies);
    return { loggedOut: true };
  }
}

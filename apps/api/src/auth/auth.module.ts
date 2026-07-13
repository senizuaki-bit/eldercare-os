import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthRateLimiterService } from './auth-rate-limiter.service.js';
import { AuthService } from './auth.service.js';
import { CredentialService } from './credential.service.js';
import { CsrfGuard } from './csrf.guard.js';
import { PrincipalService } from './principal.service.js';
import { SessionGuard } from './session.guard.js';
import { SessionService } from './session.service.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthRateLimiterService,
    AuthService,
    CredentialService,
    CsrfGuard,
    PrincipalService,
    SessionGuard,
    SessionService,
  ],
  exports: [CsrfGuard, PrincipalService, SessionGuard, SessionService],
})
export class AuthModule {}

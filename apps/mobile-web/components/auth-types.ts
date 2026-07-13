import { sessionContextSchema, type SessionContext } from '@eldercare/contracts';

import type { Role } from './types';

export type AuthSession = SessionContext;
export type Portal = AuthSession['portal'];

export function isAuthSession(value: unknown): value is AuthSession {
  return sessionContextSchema.safeParse(value).success;
}

export function isMobilePortal(portal: Portal): portal is Role {
  return portal === 'elder' || portal === 'caregiver' || portal === 'family';
}

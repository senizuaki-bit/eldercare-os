import type { Response } from 'express';

export const DEVELOPMENT_SESSION_COOKIE = 'eldercare_session';
export const DEVELOPMENT_CSRF_COOKIE = 'eldercare_csrf';
export const PRODUCTION_SESSION_COOKIE = '__Host-eldercare_session';
export const PRODUCTION_CSRF_COOKIE = '__Host-eldercare_csrf';

export interface AuthCookieOptions {
  readonly production: boolean;
  readonly maxAgeSeconds: number;
}

export function getAuthCookieNames(production: boolean): {
  session: string;
  csrf: string;
} {
  return production
    ? { session: PRODUCTION_SESSION_COOKIE, csrf: PRODUCTION_CSRF_COOKIE }
    : { session: DEVELOPMENT_SESSION_COOKIE, csrf: DEVELOPMENT_CSRF_COOKIE };
}

export function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (cookieHeader === undefined) return undefined;

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;

    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export function setAuthCookies(
  response: Response,
  sessionToken: string,
  csrfToken: string,
  options: AuthCookieOptions,
): void {
  const names = getAuthCookieNames(options.production);
  const shared = {
    maxAge: options.maxAgeSeconds * 1_000,
    path: '/',
    sameSite: 'lax' as const,
    secure: options.production,
  };

  response.cookie(names.session, sessionToken, { ...shared, httpOnly: true });
  response.cookie(names.csrf, csrfToken, { ...shared, httpOnly: false });
  response.setHeader('Cache-Control', 'no-store');
}

export function clearAuthCookies(response: Response, production: boolean): void {
  const names = getAuthCookieNames(production);
  const shared = {
    path: '/',
    sameSite: 'lax' as const,
    secure: production,
  };

  response.clearCookie(names.session, { ...shared, httpOnly: true });
  response.clearCookie(names.csrf, { ...shared, httpOnly: false });
  response.setHeader('Cache-Control', 'no-store');
}

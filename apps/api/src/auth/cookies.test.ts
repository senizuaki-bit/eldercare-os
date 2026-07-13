import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
  clearAuthCookies,
  getAuthCookieNames,
  readCookie,
  setAuthCookies,
} from './cookies.js';

interface MockResponse {
  readonly clearCookie: ReturnType<typeof vi.fn>;
  readonly cookie: ReturnType<typeof vi.fn>;
  readonly setHeader: ReturnType<typeof vi.fn>;
}

function createResponse(): MockResponse {
  return {
    clearCookie: vi.fn(),
    cookie: vi.fn(),
    setHeader: vi.fn(),
  };
}

describe('auth cookies', () => {
  it('parses only the requested cookie and rejects malformed encoding', () => {
    expect(readCookie('one=1; eldercare_session=safe-token; three=3', 'eldercare_session')).toBe(
      'safe-token',
    );
    expect(readCookie('eldercare_session=%E0%A4%A', 'eldercare_session')).toBeUndefined();
    expect(readCookie(undefined, 'eldercare_session')).toBeUndefined();
  });

  it('uses host-only secure cookie names in production', () => {
    expect(getAuthCookieNames(true)).toEqual({
      session: '__Host-eldercare_session',
      csrf: '__Host-eldercare_csrf',
    });
  });

  it('sets and clears matching secure attributes without a Domain', () => {
    const response = createResponse();
    setAuthCookies(response as unknown as Response, 'session-token', 'csrf-token', {
      maxAgeSeconds: 3600,
      production: true,
    });

    expect(response.cookie).toHaveBeenCalledWith(
      '__Host-eldercare_session',
      'session-token',
      expect.objectContaining({
        httpOnly: true,
        maxAge: 3_600_000,
        path: '/',
        sameSite: 'lax',
        secure: true,
      }),
    );
    expect(response.cookie).toHaveBeenCalledWith(
      '__Host-eldercare_csrf',
      'csrf-token',
      expect.objectContaining({ httpOnly: false, secure: true }),
    );

    clearAuthCookies(response as unknown as Response, true);
    expect(response.clearCookie).toHaveBeenCalledTimes(2);
  });
});

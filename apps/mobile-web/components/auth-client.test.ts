import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAuthSession } from '../test/auth-fixtures';
import { getSession, login, logout } from './auth-client';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mobile auth client', () => {
  it('loads the principal with credentials and without HTTP caching', async () => {
    const session = createAuthSession('family');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json(session, { status: 200 }));

    await expect(getSession()).resolves.toEqual(session);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4000/auth/session',
      expect.objectContaining({ cache: 'no-store', credentials: 'include' })
    );
  });

  it('treats an unauthenticated session response as no principal', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { error: { code: 'AUTH_REQUIRED', correlationId: 'corr-auth-1', message: '请登录' } },
        { status: 401 }
      )
    );

    await expect(getSession()).resolves.toBeNull();
  });

  it('sends login credentials in JSON and forwards the CSRF cookie header', async () => {
    const session = createAuthSession('elder');
    document.cookie = 'eldercare_csrf=csrf%20value; path=/';
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json(session, { status: 200 }));

    await expect(login('elder.demo', 'local-demo-password')).resolves.toEqual(session);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://127.0.0.1:4000/auth/login');
    expect(init).toEqual(
      expect.objectContaining({
        body: JSON.stringify({ loginName: 'elder.demo', password: 'local-demo-password' }),
        cache: 'no-store',
        credentials: 'include',
        method: 'POST'
      })
    );
    const headers = new Headers(init?.headers);
    expect(headers.get('x-csrf-token')).toBe('csrf value');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('rejects malformed successful session payloads instead of trusting them', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ portal: 'elder', user: { id: 'leaked-partial-user' } }, { status: 200 })
    );

    await expect(getSession()).rejects.toMatchObject({
      code: 'INVALID_SESSION_RESPONSE',
      status: 502
    });
  });

  it('rejects a shape-compatible response that violates the shared session contract', async () => {
    const session = createAuthSession('elder');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ ...session, user: { ...session.user, id: 'not-a-uuid' } }, { status: 200 })
    );

    await expect(getSession()).rejects.toMatchObject({
      code: 'INVALID_SESSION_RESPONSE',
      status: 502
    });
  });

  it('uses a credentialed, CSRF-protected POST for logout', async () => {
    document.cookie = 'eldercare_csrf=logout-token; path=/';
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    await expect(logout()).resolves.toBeUndefined();

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init).toEqual(
      expect.objectContaining({ cache: 'no-store', credentials: 'include', method: 'POST' })
    );
    expect(new Headers(init?.headers).get('x-csrf-token')).toBe('logout-token');
  });
});

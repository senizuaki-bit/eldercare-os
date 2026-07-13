import { cookies } from 'next/headers';

import { apiUrl } from './api-client';
import { parseAuthSession, type AuthSession } from './auth-contract';

export type SessionResult =
  | { status: 'authenticated'; session: AuthSession }
  | { status: 'unauthenticated' }
  | { status: 'unavailable' };

const SESSION_COOKIE_NAMES = new Set(['eldercare_session', '__Host-eldercare_session']);

export function serializeSessionCookies(values: Array<{ name: string; value: string }>): string {
  return values
    .filter(({ name }) => SESSION_COOKIE_NAMES.has(name))
    .map(({ name, value }) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
}

export async function getServerSession(): Promise<SessionResult> {
  const cookieStore = await cookies();
  const cookieHeader = serializeSessionCookies(cookieStore.getAll());

  try {
    const response = await fetch(apiUrl('/auth/session'), {
      cache: 'no-store',
      headers: cookieHeader.length > 0 ? { Accept: 'application/json', Cookie: cookieHeader } : { Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(4_000)
    });

    if (response.status === 401 || response.status === 403) {
      return { status: 'unauthenticated' };
    }

    if (!response.ok) {
      return { status: 'unavailable' };
    }

    return {
      status: 'authenticated',
      session: parseAuthSession(await response.json())
    };
  } catch {
    return { status: 'unavailable' };
  }
}

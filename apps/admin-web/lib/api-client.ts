const DEFAULT_API_BASE_URL = 'http://127.0.0.1:4000';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;

export function apiUrl(pathname: string): string {
  return new URL(pathname, `${API_BASE_URL.replace(/\/$/, '')}/`).toString();
}

const CSRF_COOKIE_NAMES = ['__Host-eldercare_csrf', 'eldercare_csrf'] as const;

export function readCsrfToken(
  cookieHeader = typeof document === 'undefined' ? '' : document.cookie
): string | null {
  const cookies = new Map<string, string>();
  for (const entry of cookieHeader.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0) {
      continue;
    }

    cookies.set(entry.slice(0, separator).trim(), entry.slice(separator + 1).trim());
  }

  const cookieName = CSRF_COOKIE_NAMES.find((name) => cookies.has(name));
  if (cookieName === undefined) {
    return null;
  }

  try {
    return decodeURIComponent(cookies.get(cookieName) ?? '');
  } catch {
    return null;
  }
}

export async function apiFetch(pathname: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');

  const method = (init.method ?? 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrfToken = readCsrfToken();
    if (csrfToken !== null) {
      headers.set('x-csrf-token', csrfToken);
    }
  }

  return fetch(apiUrl(pathname), {
    ...init,
    cache: 'no-store',
    credentials: 'include',
    headers
  });
}

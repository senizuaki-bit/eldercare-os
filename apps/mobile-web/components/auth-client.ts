import { isAuthSession, type AuthSession } from './auth-types';

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:4000').replace(
  /\/$/,
  ''
);
const CSRF_COOKIE_NAMES = ['__Host-eldercare_csrf', 'eldercare_csrf'] as const;
const CSRF_HEADER_NAME = 'x-csrf-token';

interface ErrorEnvelope {
  readonly error?: {
    readonly code?: string;
    readonly correlationId?: string;
    readonly message?: string;
  };
}

export class AuthRequestError extends Error {
  readonly code: string;
  readonly correlationId?: string;
  readonly status: number;

  constructor(status: number, code: string, correlationId?: string) {
    super('Authentication request failed');
    this.name = 'AuthRequestError';
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
  }
}

function readCsrfToken(): string | undefined {
  if (typeof document === 'undefined') {
    return undefined;
  }

  const parts = document.cookie.split(';').map((part) => part.trim());
  const cookieName = CSRF_COOKIE_NAMES.find((name) =>
    parts.some((part) => part.startsWith(`${name}=`))
  );

  if (!cookieName) {
    return undefined;
  }

  const prefix = `${cookieName}=`;
  const cookie = parts.find((part) => part.startsWith(prefix));

  if (!cookie) {
    return undefined;
  }

  try {
    return decodeURIComponent(cookie.slice(prefix.length));
  } catch {
    return undefined;
  }
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return undefined;
  }

  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function toAuthRequestError(response: Response, body: unknown): AuthRequestError {
  const envelope =
    typeof body === 'object' && body !== null ? (body as ErrorEnvelope) : undefined;
  return new AuthRequestError(
    response.status,
    envelope?.error?.code ?? `HTTP_${response.status}`,
    envelope?.error?.correlationId
  );
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');

  if (init.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  if (init.method && init.method !== 'GET' && init.method !== 'HEAD') {
    const csrfToken = readCsrfToken();
    if (csrfToken) {
      headers.set(CSRF_HEADER_NAME, csrfToken);
    }
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      cache: 'no-store',
      credentials: 'include',
      headers
    });
  } catch {
    throw new AuthRequestError(0, 'NETWORK_UNAVAILABLE');
  }

  const body = await readResponseBody(response);
  if (!response.ok) {
    throw toAuthRequestError(response, body);
  }

  return body;
}

function requireSession(body: unknown): AuthSession {
  if (!isAuthSession(body)) {
    throw new AuthRequestError(502, 'INVALID_SESSION_RESPONSE');
  }

  return body;
}

export async function getSession(): Promise<AuthSession | null> {
  try {
    return requireSession(await request('/auth/session'));
  } catch (error) {
    if (error instanceof AuthRequestError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

export async function login(username: string, password: string): Promise<AuthSession> {
  const body = await request('/auth/login', {
    body: JSON.stringify({ loginName: username, password }),
    method: 'POST'
  });

  if (isAuthSession(body)) {
    return body;
  }

  const session = await getSession();
  if (!session) {
    throw new AuthRequestError(502, 'INVALID_SESSION_RESPONSE');
  }

  return session;
}

export async function logout(): Promise<void> {
  await request('/auth/logout', { method: 'POST' });
}

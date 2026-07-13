import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AppProviders } from '../app/providers';
import { readCsrfToken } from '../lib/api-client';
import { safeNextPath } from '../lib/safe-navigation';
import { authSessionFixture } from '../test/fixtures';
import { LoginForm } from './login-form';

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

function renderLogin(
  onAuthenticated = vi.fn(),
  nextPath: string | null = '/users'
) {
  render(
    <AppProviders>
      <LoginForm nextPath={nextPath} onAuthenticated={onAuthenticated} />
    </AppProviders>
  );
  return onAuthenticated;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'cookie');
});

describe('LoginForm', () => {
  it('submits credentials with the CSRF header and never persists a token', async () => {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => 'eldercare_csrf=csrf-demo-value'
    });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(authSessionFixture));
    vi.stubGlobal('fetch', fetchMock);
    const authenticated = renderLogin();

    fireEvent.change(screen.getByRole('textbox', { name: '账号' }), {
      target: { value: 'supervisor.demo' }
    });
    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'fictional-password' }
    });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    await waitFor(() => expect(authenticated).toHaveBeenCalledWith('/users'));
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toBe('http://127.0.0.1:4000/auth/login');
    expect(init.credentials).toBe('include');
    expect(headers.get('x-csrf-token')).toBe('csrf-demo-value');
    expect(init.body).toBe(JSON.stringify({
      loginName: 'supervisor.demo',
      password: 'fictional-password'
    }));
    expect(window.localStorage.length).toBe(0);
  });

  it('uses one generic error for an invalid account or password', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    const authenticated = renderLogin();

    fireEvent.change(screen.getByRole('textbox', { name: '账号' }), {
      target: { value: 'unknown.demo' }
    });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('账号或密码不正确');
    expect(authenticated).not.toHaveBeenCalled();
    expect(screen.queryByText(/账号不存在|密码错误/)).not.toBeInTheDocument();
  });

  it('routes a valid non-admin session to a data-free forbidden page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      ...authSessionFixture,
      portal: 'caregiver'
    })));
    const authenticated = renderLogin();

    fireEvent.change(screen.getByRole('textbox', { name: '账号' }), {
      target: { value: 'caregiver.demo' }
    });
    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'fictional-password' }
    });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    await waitFor(() => expect(authenticated).toHaveBeenCalledWith('/forbidden'));
  });

  it('does not navigate when a successful response violates the session contract', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ portal: 'admin' })));
    const authenticated = renderLogin();

    fireEvent.change(screen.getByRole('textbox', { name: '账号' }), {
      target: { value: 'supervisor.demo' }
    });
    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'fictional-password' }
    });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('登录服务暂时不可用');
    expect(authenticated).not.toHaveBeenCalled();
  });
});

describe('auth navigation helpers', () => {
  it('rejects external and recursive login return targets', () => {
    expect(safeNextPath('https://example.test/steal')).toBe('/');
    expect(safeNextPath('//example.test/steal')).toBe('/');
    expect(safeNextPath('/login?next=/users')).toBe('/');
    expect(safeNextPath('/roles')).toBe('/roles');
  });

  it('reads only the named CSRF cookie', () => {
    expect(readCsrfToken('other=one; eldercare_csrf=safe%20token; ignored=two')).toBe('safe token');
    expect(readCsrfToken('eldercare_csrf=dev; __Host-eldercare_csrf=production')).toBe('production');
    expect(readCsrfToken('eldercare_csrf=%E0%A4%A')).toBeNull();
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AppProviders } from '../app/providers';
import { parseAuthSession } from '../lib/auth-contract';
import {
  authSessionFixture,
  haitangFacilityId,
  organizationId,
  switchedAuthSessionFixture
} from '../test/fixtures';
import { AdminShell } from './admin-shell';

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

vi.mock('next/navigation', () => ({
  usePathname: () => '/users'
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'cookie');
});

describe('AdminShell session controls', () => {
  it('shows the authenticated identity and submits a backend-approved context switch', async () => {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => 'eldercare_csrf=context-token'
    });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(switchedAuthSessionFixture));
    vi.stubGlobal('fetch', fetchMock);
    const reload = vi.fn();
    expect(parseAuthSession(switchedAuthSessionFixture)).toEqual(switchedAuthSessionFixture);

    render(
      <AppProviders>
        <AdminShell session={authSessionFixture} onReload={reload}>
          <p>受保护内容</p>
        </AdminShell>
      </AppProviders>
    );

    expect(screen.getByRole('button', { name: '打开个人菜单' })).toHaveTextContent('林主管（虚构）');
    const contextSelect = screen.getByRole('combobox', { name: '切换机构和院区访问范围' });
    fireEvent.mouseDown(contextSelect.parentElement?.parentElement ?? contextSelect);
    await screen.findByRole('option', { name: /海棠院区/ });
    const haitangOption = [...document.querySelectorAll('.ant-select-item-option-content')]
      .find((element) => element.textContent?.includes('海棠院区'))
      ?.parentElement;
    expect(haitangOption).toBeTruthy();
    fireEvent.click(haitangOption!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:4000/auth/context');
    expect(new Headers(init.headers).get('x-csrf-token')).toBe('context-token');
    expect(init.body).toBe(JSON.stringify({
      organizationId,
      facilityId: haitangFacilityId
    }));
  });

  it('invalidates the server session before navigating to the logged-out screen', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const navigate = vi.fn();

    render(
      <AppProviders>
        <AdminShell session={authSessionFixture} onNavigate={navigate}>
          <p>受保护内容</p>
        </AdminShell>
      </AppProviders>
    );

    fireEvent.click(screen.getByRole('button', { name: '打开个人菜单' }));
    fireEvent.click(await screen.findByText('安全退出'));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login?reason=logout'));
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4000/auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'include' })
    );
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AppProviders } from '../app/providers';
import {
  authSessionFixture,
  organizationId,
  qinglanFacilityId,
  rolesFixture,
  usersFixture
} from '../test/fixtures';
import { AccessManagementPage } from './access-management-page';
import { AdminShell } from './admin-shell';

vi.mock('next/navigation', () => ({
  usePathname: () => '/users'
}));

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

function renderAccessPage(kind: 'users' | 'roles') {
  return render(
    <AppProviders>
      <AdminShell session={authSessionFixture}>
        <AccessManagementPage kind={kind} />
      </AdminShell>
    </AppProviders>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AccessManagementPage', () => {
  it('renders a scoped, read-only user list and detail drawer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(usersFixture));
    vi.stubGlobal('fetch', fetchMock);
    renderAccessPage('users');

    expect(await screen.findByText('陈护工（虚构）')).toBeInTheDocument();
    expect(screen.getAllByText('青岚院区（演示）').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /新增|编辑|删除/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '查看详情' }));
    expect(await screen.findByText('只读访问详情')).toBeInTheDocument();
    expect(screen.getByText('v3')).toBeInTheDocument();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/admin/organizations/${organizationId}/facilities/${qinglanFacilityId}/users`);
    expect(url).toContain('sort=displayName');
    expect(url).toContain('direction=asc');
    expect(init.credentials).toBe('include');
  });

  it('renders role permissions and data scopes without edit controls', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(rolesFixture)));
    renderAccessPage('roles');

    expect(await screen.findByText('NURSING_SUPERVISOR')).toBeInTheDocument();
    expect(screen.getByText('3 项权限')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看详情' }));
    expect(await screen.findByText('权限按后端策略执行')).toBeInTheDocument();
    expect(screen.getByText('identity.access.manage')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /保存|编辑/ })).not.toBeInTheDocument();
  });

  it('sends top-bar search terms to the scoped endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(usersFixture));
    vi.stubGlobal('fetch', fetchMock);
    renderAccessPage('users');
    await screen.findByText('陈护工（虚构）');

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索当前页面' }), {
      target: { value: '陈护工' }
    });

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('search=%E9%99%88%E6%8A%A4%E5%B7%A5'))).toBe(true);
    });
  });

  it('clears previously rendered identities when the scoped endpoint becomes unavailable by policy', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(usersFixture))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    renderAccessPage('users');
    expect(await screen.findByText('陈护工（虚构）')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索当前页面' }), {
      target: { value: 'policy-change' }
    });

    expect(await screen.findByText('页面不存在或不可访问')).toBeInTheDocument();
    expect(screen.queryByText('陈护工（虚构）')).not.toBeInTheDocument();
    expect(screen.getByText('系统不会透露其他机构或院区是否存在对应资源。')).toBeInTheDocument();
  });

  it('rejects a response that contains an assignment from another organization', async () => {
    const crossOrganizationPayload = {
      ...usersFixture,
      items: [
        {
          ...usersFixture.items[0],
          assignments: usersFixture.items[0]!.assignments.map((assignment) => ({
            ...assignment,
            organizationId: '00000000-0000-4000-8000-000000009999'
          }))
        }
      ]
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(crossOrganizationPayload)));
    renderAccessPage('users');

    expect(await screen.findByText('无法读取访问列表')).toBeInTheDocument();
    expect(screen.queryByText('陈护工（虚构）')).not.toBeInTheDocument();
  });

  it('never sends unsupported role or built-in filters to strict list endpoints', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(rolesFixture));
    vi.stubGlobal('fetch', fetchMock);
    renderAccessPage('roles');
    await screen.findByText('NURSING_SUPERVISOR');

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain('role=');
    expect(url).not.toContain('builtIn=');
    expect(url).toContain('sort=name');
    expect(url).toContain('direction=asc');
  });

  it('requests tenant-scoped server sorting instead of sorting one role page locally', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(rolesFixture));
    vi.stubGlobal('fetch', fetchMock);
    renderAccessPage('roles');
    await screen.findByText('NURSING_SUPERVISOR');

    fireEvent.click(screen.getByRole('columnheader', { name: /已分配用户/ }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) =>
        String(url).includes('sort=assignedUserCount') && String(url).includes('direction=asc')
      )).toBe(true);
    });
  });

  it('keeps identity and action columns while allowing optional columns to be hidden', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(usersFixture)));
    renderAccessPage('users');
    await screen.findByText('陈护工（虚构）');

    fireEvent.click(screen.getByRole('button', { name: '设置表格可见列' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: '最近登录' }));

    expect(screen.queryByRole('columnheader', { name: /最近登录/ })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /用户/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /操作/ })).toBeInTheDocument();
  });
});

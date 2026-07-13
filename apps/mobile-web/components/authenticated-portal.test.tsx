import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuthSession } from '../test/auth-fixtures';
import { AuthenticatedPortal } from './authenticated-portal';

const replace = vi.fn();
const router = { replace };

vi.mock('next/navigation', () => ({
  useRouter: () => router
}));

beforeEach(() => {
  replace.mockReset();
  window.sessionStorage.clear();
});

describe('AuthenticatedPortal', () => {
  it('renders no protected data when the URL role differs from the principal portal', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(createAuthSession('family'), { status: 200 })
    );

    render(<AuthenticatedPortal requestedRole="caregiver" />);

    expect(await screen.findByRole('heading', { name: '您无权查看此门户' })).toBeInTheDocument();
    expect(screen.getByText(/当前会话与网址中的门户角色不一致/)).toBeInTheDocument();
    expect(screen.queryByText('早班任务')).not.toBeInTheDocument();
    expect(screen.queryByText('今日照护摘要')).not.toBeInTheDocument();
    expect(screen.queryByText('虚构测试用户')).not.toBeInTheDocument();
    expect(screen.queryByText('安心照护演示机构')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '进入授权门户' }));
    expect(replace).toHaveBeenCalledWith('/m/family/home');
  });

  it('redirects an unauthenticated request to login without rendering a portal', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ error: { code: 'AUTH_REQUIRED', message: '请登录' } }, { status: 401 })
    );

    render(<AuthenticatedPortal requestedRole="elder" />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByText(/点击说需求/)).not.toBeInTheDocument();
  });

  it('does not fall back to protected fixture data when the auth service is offline', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network unavailable'));

    render(<AuthenticatedPortal requestedRole="elder" />);

    expect(await screen.findByRole('heading', { name: '暂时无法确认权限' })).toBeInTheDocument();
    expect(screen.getByText(/不会回退到旧门户数据/)).toBeInTheDocument();
    expect(screen.queryByText(/点击说需求/)).not.toBeInTheDocument();
  });
});

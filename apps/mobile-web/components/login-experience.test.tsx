import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuthSession } from '../test/auth-fixtures';
import { LoginExperience } from './login-experience';

const replace = vi.fn();
const router = { replace };

vi.mock('next/navigation', () => ({
  useRouter: () => router
}));

beforeEach(() => {
  vi.restoreAllMocks();
  replace.mockReset();
  window.sessionStorage.clear();
});

describe('LoginExperience', () => {
  it('clears private state when the server confirms there is no active session', async () => {
    window.sessionStorage.setItem('eldercare:draft', 'prior-user-draft');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ error: { code: 'AUTH_REQUIRED', message: '请登录' } }, { status: 401 })
    );

    render(<LoginExperience />);

    await screen.findByRole('button', { name: '安全登录' });
    expect(window.sessionStorage.getItem('eldercare:draft')).toBeNull();
  });

  it('logs in and routes according to the server-selected portal', async () => {
    const user = userEvent.setup();
    const session = createAuthSession('family');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json({ error: { code: 'AUTH_REQUIRED', message: '请登录' } }, { status: 401 })
      )
      .mockResolvedValueOnce(Response.json(session, { status: 200 }));

    render(<LoginExperience />);

    const submit = await screen.findByRole('button', { name: '安全登录' });
    await user.type(screen.getByLabelText('账号'), 'family.demo');
    await user.type(screen.getByLabelText('密码'), 'local-demo-password');
    await user.click(submit);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/m/family/home'));
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://127.0.0.1:4000/auth/login');
    expect(screen.queryByText(/切换界面角色/)).not.toBeInTheDocument();
  });

  it('shows the same safe message for rejected credentials', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json({ error: { code: 'AUTH_REQUIRED', message: '请登录' } }, { status: 401 })
      )
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: 'INVALID_CREDENTIALS', message: '内部诊断不应显示' } },
          { status: 401 }
        )
      );

    render(<LoginExperience />);

    await user.type(screen.getByLabelText('账号'), 'unknown.demo');
    await user.type(screen.getByLabelText('密码'), 'wrong-password');
    await user.click(await screen.findByRole('button', { name: '安全登录' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('账号或密码不正确。');
    expect(screen.queryByText('内部诊断不应显示')).not.toBeInTheDocument();
  });
});

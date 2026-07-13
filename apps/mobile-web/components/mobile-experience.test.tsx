import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createAuthSession } from '../test/auth-fixtures';
import { MobileExperience } from './mobile-experience';

describe('MobileExperience', () => {
  it('uses the authenticated elder principal and has no local role switch', () => {
    render(
      <MobileExperience
        onSignedOut={vi.fn()}
        role="elder"
        session={createAuthSession('elder')}
      />
    );

    expect(screen.getByRole('heading', { name: '早上好，林安宁' })).toBeInTheDocument();
    expect(screen.getByText('服务器会话已确认 · 当前内容均为虚构本地示例')).toBeInTheDocument();
    expect(screen.getByText('AI 关怀助手（演示）')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /点击说需求/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /紧急求助/ })).toBeInTheDocument();
    expect(screen.queryByText(/演示角色|切换界面角色/)).not.toBeInTheDocument();
  });

  it('simulates the elder voice interaction without claiming a real submission', async () => {
    const user = userEvent.setup();
    render(
      <MobileExperience
        onSignedOut={vi.fn()}
        role="elder"
        session={createAuthSession('elder')}
      />
    );

    const voiceButton = screen.getByRole('button', { name: /点击说需求/ });
    await user.click(voiceButton);

    expect(screen.getByRole('button', { name: /正在聆听/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('本地演示进入聆听状态；未启用麦克风。')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /正在聆听/ }));

    expect(screen.getByText('“我想喝一杯温水”')).toBeInTheDocument();
    expect(screen.getByText(/不会保存录音、转写或创建工单/)).toBeInTheDocument();
  });

  it('keeps the authenticated family portal privacy-filtered', () => {
    render(
      <MobileExperience
        onSignedOut={vi.fn()}
        role="family"
        session={createAuthSession('family')}
      />
    );

    expect(screen.getByRole('heading', { name: '今日照护摘要' })).toBeInTheDocument();
    expect(screen.getByText('已隐藏原始录音、完整对话、内部备注和护工实时位置。')).toBeInTheDocument();
    expect(screen.queryByText(/护工当前位置/)).not.toBeInTheDocument();
    expect(screen.queryByText(/312 室/)).not.toBeInTheDocument();
  });

  it('keeps role-specific bottom navigation interactive', async () => {
    const user = userEvent.setup();
    render(
      <MobileExperience
        onSignedOut={vi.fn()}
        role="family"
        session={createAuthSession('family')}
      />
    );

    await user.click(screen.getByRole('button', { name: '服务' }));

    expect(screen.getByRole('heading', { name: '服务导航壳' })).toBeInTheDocument();
    expect(screen.getByText(/当前不会读取真实老人数据/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '服务' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows account context and performs a CSRF-protected logout', async () => {
    const user = userEvent.setup();
    const onSignedOut = vi.fn();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    document.cookie = 'eldercare_csrf=csrf-test-value; path=/';

    render(
      <MobileExperience
        onSignedOut={onSignedOut}
        role="caregiver"
        session={createAuthSession('caregiver')}
      />
    );

    await user.click(screen.getByRole('button', { name: /虚构测试用户/ }));
    expect(screen.getByText('caregiver.demo')).toBeInTheDocument();
    expect(screen.getByText('安心照护演示机构 · 青松院区')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '退出登录' }));

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4000/auth/logout',
      expect.objectContaining({
        credentials: 'include',
        method: 'POST'
      })
    );
    const requestInit = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(requestInit?.headers).get('x-csrf-token')).toBe('csrf-test-value');
    expect(onSignedOut).toHaveBeenCalledOnce();
  });

  it('keeps keyboard focus inside the account dialog and restores it on Escape', async () => {
    const user = userEvent.setup();
    render(
      <MobileExperience
        onSignedOut={vi.fn()}
        role="family"
        session={createAuthSession('family')}
      />
    );

    const trigger = screen.getByRole('button', { name: /虚构测试用户/ });
    await user.click(trigger);

    const closeButton = screen.getByRole('button', { name: '关闭账号菜单' });
    const logoutButton = screen.getByRole('button', { name: '退出登录' });
    expect(closeButton).toHaveFocus();

    await user.tab({ shift: true });
    expect(logoutButton).toHaveFocus();
    await user.tab();
    expect(closeButton).toHaveFocus();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

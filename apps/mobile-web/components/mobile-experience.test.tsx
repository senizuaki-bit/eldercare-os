import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAuthSession } from '../test/auth-fixtures';
import { MobileExperience } from './mobile-experience';

const pageInfo = { page: 1, pageSize: 20, total: 0, totalPages: 0 };
const workOrderId = '00000000-0000-4000-8000-000000000501';

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function emptyPortalFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = requestUrl(input);
    if (url.endsWith('/auth/logout')) {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return Promise.resolve(Response.json({ items: [], pageInfo }));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('MobileExperience', () => {
  it('uses the authenticated elder principal and has no local role switch', () => {
    emptyPortalFetch();
    render(
      <MobileExperience
        onSignedOut={vi.fn()}
        role="elder"
        session={createAuthSession('elder')}
      />
    );

    expect(screen.getByRole('heading', { name: '早上好，林安宁' })).toBeInTheDocument();
    expect(screen.getByText('服务器会话已确认 · 业务结果以服务端为准')).toBeInTheDocument();
    expect(screen.getByText('AI 关怀助手')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /点击说需求/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /紧急求助/ })).toBeEnabled();
    expect(screen.queryByText(/演示角色|切换界面角色/)).not.toBeInTheDocument();
  });

  it('opens the elder emergency flow in an honest pending state', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = requestUrl(input);
      if (
        url.endsWith('/elder/emergencies') &&
        init?.method === 'POST'
      ) {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true }
          );
        });
      }
      return Promise.resolve(Response.json({ items: [], pageInfo }));
    });
    render(
      <MobileExperience
        onSignedOut={vi.fn()}
        role="elder"
        session={createAuthSession('elder')}
      />
    );

    await user.click(screen.getByRole('button', { name: /紧急求助/ }));

    expect(window.location.pathname).toBe('/m/elder/emergency');
    expect(
      screen.getByRole('heading', { name: '正在发送求助' })
    ).toBeInTheDocument();
    expect(screen.queryByText('求助已经登记')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '拨打 120' })).toHaveAttribute(
      'href',
      'tel:120'
    );
  });

  it('navigates to the explicit elder voice workflow and supports an end action', async () => {
    const user = userEvent.setup();
    emptyPortalFetch();
    render(
      <MobileExperience
        onSignedOut={vi.fn()}
        role="elder"
        session={createAuthSession('elder')}
      />
    );

    await user.click(screen.getByRole('button', { name: /点击说需求/ }));

    expect(screen.getByRole('heading', { name: '说出您的需要' })).toBeInTheDocument();
    expect(screen.getByText('这是 AI 关怀助手')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消并返回' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/m/elder/voice-request');
  });

  it('blocks shell, account, and popstate exits while an elder submission is unconfirmed', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = requestUrl(input);
      if (url.endsWith('/elder/voice-submissions/demo')) {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(new DOMException('aborted', 'AbortError'));
            return;
          }
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true }
          );
        });
      }
      return Promise.resolve(Response.json({ items: [], pageInfo }));
    });

    render(
      <MobileExperience
        onSignedOut={vi.fn()}
        role="elder"
        session={createAuthSession('elder')}
      />
    );

    await user.click(screen.getByRole('button', { name: /点击说需求/ }));
    await user.click(screen.getByRole('button', { name: /提交演示语句/ }));
    expect(await screen.findByText('正在安全上传')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '安排' }));
    expect(screen.getByRole('heading', { name: '说出您的需要' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('当前操作尚未得到服务器最终确认');

    await user.click(screen.getByRole('button', { name: /林安宁/ }));
    expect(screen.getByRole('button', { name: '退出登录' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '关闭账号菜单' }));

    act(() => {
      window.history.replaceState(null, '', '/m/elder/home');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(window.location.pathname).toBe('/m/elder/voice-request');
    expect(screen.getByRole('heading', { name: '说出您的需要' })).toBeInTheDocument();
  });

  it('keeps the authenticated family portal privacy-filtered', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = requestUrl(input);
      if (url.endsWith('/family/summaries')) {
        return Promise.resolve(Response.json({
          items: [
            {
              caregiverLocation: '312 室走廊',
              fullTranscript: '完整转写内容',
              id: '00000000-0000-4000-8000-000000000502',
              publishedAt: '2026-07-21T09:30:00.000+08:00',
              serviceCompletedAt: '2026-07-21T09:00:00.000+08:00',
              status: 'PUBLISHED',
              summary: '已送达温水，长者确认服务完成。',
              title: '生活照护已完成',
              workOrderId
            }
          ],
          pageInfo
        }));
      }
      return Promise.resolve(Response.json({ items: [], pageInfo }));
    });

    render(
      <MobileExperience
        onSignedOut={vi.fn()}
        role="family"
        session={createAuthSession('family')}
      />
    );

    expect(screen.getByRole('heading', { name: '今日照护摘要' })).toBeInTheDocument();
    expect(
      screen.getByText('原始音频、完整转写、内部备注和护工实时位置不会出现在这里。')
    ).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: '生活照护已完成' })).toBeInTheDocument();
    expect(screen.queryByText(/312 室走廊|完整转写内容/)).not.toBeInTheDocument();
  });

  it('keeps the caregiver priority task before the assigned-elder roster', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = requestUrl(input);
      if (url.endsWith('/caregiver/work-orders')) {
        return Promise.resolve(Response.json({
          items: [
            {
              arrivedAt: null,
              code: 'WO-501',
              completedAt: null,
              dueAt: '2026-07-21T09:30:00.000+08:00',
              id: workOrderId,
              priority: 'IMMEDIATE_REVIEW',
              status: 'ASSIGNED',
              summary: '请按安全提示人工复核。',
              title: '请确认演示用户的头晕反馈',
              version: 1
            }
          ],
          pageInfo: { ...pageInfo, total: 1, totalPages: 1 }
        }));
      }
      return Promise.resolve(Response.json({ items: [], pageInfo }));
    });

    render(
      <MobileExperience
        onSignedOut={vi.fn()}
        role="caregiver"
        session={createAuthSession('caregiver')}
      />
    );

    const priorityTask = await screen.findByRole('heading', {
      name: '请确认演示用户的头晕反馈'
    });
    const rosterState = await screen.findByText('当前没有可访问的老人档案');
    expect(
      priorityTask.compareDocumentPosition(rosterState) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('keeps role-specific bottom navigation interactive', async () => {
    const user = userEvent.setup();
    emptyPortalFetch();
    render(
      <MobileExperience
        onSignedOut={vi.fn()}
        role="family"
        session={createAuthSession('family')}
      />
    );

    await user.click(screen.getByRole('button', { name: '服务' }));

    expect(screen.getByRole('heading', { name: '服务' })).toBeInTheDocument();
    expect(screen.getByText(/不会读取未经授权的老人数据/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '服务' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows account context and performs a CSRF-protected logout', async () => {
    const user = userEvent.setup();
    const onSignedOut = vi.fn();
    const fetchMock = emptyPortalFetch();
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

    const logoutCall = fetchMock.mock.calls.find(
      ([url]) => url === 'http://127.0.0.1:4000/auth/logout'
    );
    expect(logoutCall).toBeDefined();
    expect(logoutCall?.[1]).toEqual(
      expect.objectContaining({ credentials: 'include', method: 'POST' })
    );
    expect(new Headers(logoutCall?.[1]?.headers).get('x-csrf-token')).toBe('csrf-test-value');
    expect(onSignedOut).toHaveBeenCalledOnce();
  });

  it('keeps keyboard focus inside the account dialog and restores it on Escape', async () => {
    const user = userEvent.setup();
    emptyPortalFetch();
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

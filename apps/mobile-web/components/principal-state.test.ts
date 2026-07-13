import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuthSession } from '../test/auth-fixtures';
import { clearPrivateClientState, recordPrincipal } from './principal-state';

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('private client state', () => {
  it('removes only eldercare session keys during logout cleanup', async () => {
    window.sessionStorage.setItem('eldercare:draft', 'private-draft');
    window.sessionStorage.setItem('unrelated', 'keep-me');

    await clearPrivateClientState();

    expect(window.sessionStorage.getItem('eldercare:draft')).toBeNull();
    expect(window.sessionStorage.getItem('unrelated')).toBe('keep-me');
  });

  it('clears prior private state when the authenticated principal changes', async () => {
    await recordPrincipal(createAuthSession('elder'));
    window.sessionStorage.setItem('eldercare:draft', 'elder-private-draft');

    await recordPrincipal(createAuthSession('family'));

    expect(window.sessionStorage.getItem('eldercare:draft')).toBeNull();
    expect(window.sessionStorage.getItem('eldercare:principal-key')).toBe(
      '00000000-0000-4000-8000-000000000003:10000000-0000-4000-8000-000000000001:20000000-0000-4000-8000-000000000001:family:FAMILY'
    );
  });

  it('clears prior private state when access roles change for the same principal', async () => {
    const session = createAuthSession('caregiver');
    await recordPrincipal(session);
    window.sessionStorage.setItem('eldercare:draft', 'scope-bound-draft');

    await recordPrincipal({
      ...session,
      roles: [...session.roles, { key: 'NURSING_SUPERVISOR', label: '护理主管' }]
    });

    expect(window.sessionStorage.getItem('eldercare:draft')).toBeNull();
    expect(window.sessionStorage.getItem('eldercare:principal-key')).toContain(
      ':caregiver:CAREGIVER,NURSING_SUPERVISOR'
    );
  });

  it('notifies the active service worker when cleanup is available', async () => {
    const postMessage = vi.fn();
    const getRegistration = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { controller: { postMessage }, getRegistration }
    });

    await clearPrivateClientState();

    expect(postMessage).toHaveBeenCalledWith({ type: 'CLEAR_PRIVATE_DATA' });
    expect(getRegistration).toHaveBeenCalledOnce();
  });
});

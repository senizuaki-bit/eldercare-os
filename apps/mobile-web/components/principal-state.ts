import type { AuthSession } from './auth-types';

const STORAGE_PREFIX = 'eldercare:';
const PRINCIPAL_KEY = `${STORAGE_PREFIX}principal-key`;

function postClearMessage(worker: ServiceWorker | null | undefined): void {
  worker?.postMessage({ type: 'CLEAR_PRIVATE_DATA' });
}

export async function clearPrivateClientState(): Promise<void> {
  if (typeof window !== 'undefined') {
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith(STORAGE_PREFIX)) {
        window.sessionStorage.removeItem(key);
      }
    }
  }

  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  postClearMessage(navigator.serviceWorker.controller);

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    postClearMessage(registration?.active);
    postClearMessage(registration?.waiting);
  } catch {
    // The protected routes remain network-only even if cleanup messaging is unavailable.
  }
}

export async function recordPrincipal(session: AuthSession): Promise<void> {
  if (typeof window === 'undefined') {
    return;
  }

  const nextPrincipalKey = [
    session.user.id,
    session.activeContext.organizationId,
    session.activeContext.facilityId ?? 'organization',
    session.portal,
    session.roles
      .map((role) => role.key)
      .sort((left, right) => left.localeCompare(right))
      .join(',')
  ].join(':');
  const previousPrincipalKey = window.sessionStorage.getItem(PRINCIPAL_KEY);

  if (previousPrincipalKey && previousPrincipalKey !== nextPrincipalKey) {
    await clearPrivateClientState();
  }

  window.sessionStorage.setItem(PRINCIPAL_KEY, nextPrincipalKey);
}

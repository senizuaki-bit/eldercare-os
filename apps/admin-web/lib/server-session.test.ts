import { serializeSessionCookies } from './server-session';

describe('server session forwarding', () => {
  it('forwards only recognized opaque session cookies to the API', () => {
    expect(
      serializeSessionCookies([
        { name: 'analytics', value: 'do-not-forward' },
        { name: 'eldercare_session', value: 'opaque/value' },
        { name: '__Host-eldercare_session', value: 'production-token' },
        { name: 'eldercare_csrf', value: 'not-needed-for-read' }
      ])
    ).toBe('eldercare_session=opaque%2Fvalue; __Host-eldercare_session=production-token');
  });
});

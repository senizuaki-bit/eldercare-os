import {
  ContractValidationError,
  parseAdminRoles,
  parseAdminUsers,
  parseAuthSession
} from './auth-contract';
import { authSessionFixture, rolesFixture, usersFixture } from '../test/fixtures';

describe('admin auth contracts', () => {
  it('accepts the documented M01 session and read models', () => {
    expect(parseAuthSession(authSessionFixture)).toEqual(authSessionFixture);
    expect(parseAdminUsers(usersFixture)).toEqual(usersFixture);
    expect(parseAdminRoles(rolesFixture)).toEqual(rolesFixture);
  });

  it('rejects incomplete session and cross-shape payloads without echoing values', () => {
    expect(() => parseAuthSession({ user: { username: 'private-value' } })).toThrow(
      ContractValidationError
    );

    try {
      parseAuthSession({ user: { username: 'private-value' } });
    } catch (error) {
      expect((error as Error).message).not.toContain('private-value');
    }
  });

  it('rejects malformed pagination instead of trusting server data', () => {
    expect(() => parseAdminUsers({ items: [], pageInfo: { page: -1, pageSize: 10, total: 0, totalPages: 0 } })).toThrow(
      ContractValidationError
    );
    expect(() => parseAdminRoles({ items: 'not-an-array', pageInfo: { page: 1, pageSize: 10, total: 0, totalPages: 0 } })).toThrow(
      ContractValidationError
    );
  });

  it('rejects undocumented fields just like the strict shared schemas', () => {
    expect(() => parseAdminUsers({ ...usersFixture, organizationName: 'should-not-pass' })).toThrow(
      ContractValidationError
    );
    expect(() => parseAdminRoles({ ...rolesFixture, secret: 'should-not-pass' })).toThrow(
      ContractValidationError
    );
  });
});

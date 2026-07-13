import { hashPassword } from '@eldercare/authz/server';
import { describe, expect, it } from 'vitest';
import { CredentialService } from './credential.service.js';

describe('CredentialService', () => {
  const service = new CredentialService();

  it('normalizes login identifiers without exposing password behavior', () => {
    expect(service.normalizeLoginName('  Director.Demo  ')).toBe('director.demo');
  });

  it('verifies known credentials and safely rejects absent credentials', async () => {
    const hash = await hashPassword('Local-Test-Password!');
    await expect(service.verify('Local-Test-Password!', hash)).resolves.toBe(true);
    await expect(service.verify('Wrong-Test-Password!', hash)).resolves.toBe(false);
    await expect(service.verify('Wrong-Test-Password!', undefined)).resolves.toBe(false);
  });
});

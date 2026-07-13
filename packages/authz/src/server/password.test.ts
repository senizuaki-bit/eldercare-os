import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('produces an encoded scrypt hash and verifies without exposing the password', async () => {
    const password = 'LocalDemoOnly!2026';
    const encoded = await hashPassword(password, { salt: new Uint8Array(16).fill(7) });

    expect(encoded).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(encoded).not.toContain(password);
    await expect(verifyPassword(password, encoded)).resolves.toBe(true);
    await expect(verifyPassword('WrongPassword!2026', encoded)).resolves.toBe(false);
  });

  it('fails closed for malformed hashes and rejects weak input when creating a hash', async () => {
    await expect(verifyPassword('LocalDemoOnly!2026', 'not-a-password-hash')).resolves.toBe(false);
    await expect(hashPassword('too-short')).rejects.toThrow('between 12 and 256');
    await expect(
      hashPassword('LocalDemoOnly!2026', { salt: new Uint8Array(15) }),
    ).rejects.toThrow('exactly 16 bytes');
    await expect(
      verifyPassword(
        'LocalDemoOnly!2026',
        'scrypt$32768$8$1$!!!!!!!!!!!!!!!!!!!!!!$___________________________________________',
      ),
    ).resolves.toBe(false);
  });
});

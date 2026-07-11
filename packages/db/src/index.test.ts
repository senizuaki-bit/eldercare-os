import { describe, expect, it } from 'vitest';

import { createPrismaClient } from './index.js';

describe('createPrismaClient', () => {
  it('constructs the Prisma 7 pg adapter without opening a query', async () => {
    const prisma = createPrismaClient(
      'postgresql://local-user:local-password@127.0.0.1:5432/eldercare-test',
    );

    expect(prisma).toBeDefined();
    await prisma.$disconnect();
  });

  it('rejects absent and non-PostgreSQL connection strings without echoing them', () => {
    expect(() => createPrismaClient('')).toThrow('valid direct PostgreSQL');
    expect(() => createPrismaClient('redis://user:highly-secret@localhost:6379')).toThrow(
      'valid direct PostgreSQL',
    );

    try {
      createPrismaClient('not-a-url-with-highly-secret');
    } catch (error) {
      expect(String(error)).not.toContain('highly-secret');
    }
  });
});

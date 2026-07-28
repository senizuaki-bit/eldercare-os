import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/prisma/client.js';

export { Prisma, PrismaClient } from './generated/prisma/client.js';

function assertDirectPostgresUrl(databaseUrl: string): void {
  let protocol: string;

  try {
    protocol = new URL(databaseUrl).protocol;
  } catch {
    throw new Error('A valid direct PostgreSQL DATABASE_URL is required');
  }

  if (protocol !== 'postgres:' && protocol !== 'postgresql:') {
    throw new Error('A valid direct PostgreSQL DATABASE_URL is required');
  }
}

export function createPrismaClient(
  databaseUrl: string = process.env['DATABASE_URL'] ?? '',
): PrismaClient {
  assertDirectPostgresUrl(databaseUrl);
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}

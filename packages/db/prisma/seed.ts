import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

import { createPrismaClient } from '../src/index.js';

const rootEnvironmentFile = new URL('../../../.env', import.meta.url);
if (existsSync(rootEnvironmentFile)) {
  loadEnvFile(rootEnvironmentFile);
}

async function seed(): Promise<void> {
  const prisma = createPrismaClient();

  try {
    await prisma.systemMetadata.upsert({
      where: { key: 'foundation.seed' },
      create: {
        key: 'foundation.seed',
        value: { schemaVersion: '1.0', containsBusinessFixtures: false },
      },
      update: {
        value: { schemaVersion: '1.0', containsBusinessFixtures: false },
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

void seed().catch(() => {
  console.error('Database seed failed. Check the database service logs for safe diagnostics.');
  process.exitCode = 1;
});

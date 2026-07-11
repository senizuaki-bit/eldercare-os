import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

import { defineConfig } from 'prisma/config';

const rootEnvironmentFile = new URL('../../.env', import.meta.url);
if (existsSync(rootEnvironmentFile)) {
  loadEnvFile(rootEnvironmentFile);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Generation does not connect. Runtime and migration commands still fail if this
    // non-routable fallback is used, while clean installs can generate the client.
    url:
      process.env['DATABASE_URL'] ??
      'postgresql://configuration-required:configuration-required@127.0.0.1:1/configuration-required',
  },
});

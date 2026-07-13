import { describe, expect, it } from 'vitest';

import { assertDemoSeedAllowed } from './seed-policy.js';

describe('demo seed policy', () => {
  it.each([
    { ELDERCARE_ALLOW_DEMO_SEED: 'true' },
    { NODE_ENV: 'production', ELDERCARE_ALLOW_DEMO_SEED: 'true' },
    { NODE_ENV: 'development' },
    { NODE_ENV: 'test', ELDERCARE_ALLOW_DEMO_SEED: 'false' },
  ] satisfies NodeJS.ProcessEnv[])('rejects unsafe environment %#', (environment) => {
    expect(() => assertDemoSeedAllowed(environment)).toThrow('Fictional local demo seed requires');
  });

  it.each(['development', 'test'] as const)('allows an explicitly opted-in %s seed', (nodeEnvironment) => {
    expect(() =>
      assertDemoSeedAllowed({
        NODE_ENV: nodeEnvironment,
        ELDERCARE_ALLOW_DEMO_SEED: 'true',
      }),
    ).not.toThrow();
  });
});

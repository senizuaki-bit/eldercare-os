const ALLOWED_DEMO_SEED_ENVIRONMENTS = new Set(['development', 'test']);

export function assertDemoSeedAllowed(environment: NodeJS.ProcessEnv): void {
  const nodeEnvironment = environment['NODE_ENV'];
  const explicitlyAllowed = environment['ELDERCARE_ALLOW_DEMO_SEED'] === 'true';

  if (!ALLOWED_DEMO_SEED_ENVIRONMENTS.has(nodeEnvironment ?? '') || !explicitlyAllowed) {
    throw new Error(
      'Fictional local demo seed requires NODE_ENV=development|test and ELDERCARE_ALLOW_DEMO_SEED=true',
    );
  }
}

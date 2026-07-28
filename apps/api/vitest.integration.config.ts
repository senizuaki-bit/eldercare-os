import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    passWithNoTests: false,
    // Integration suites intentionally exercise one shared, seeded database.
    // Running files in parallel makes their time-bound shift and audit fixtures
    // interfere with one another, so the required root command stays serial.
    fileParallelism: false,
    // Real PostgreSQL and MinIO lifecycle coverage includes bounded retries and
    // must not inherit Vitest's unit-test-oriented five-second default.
    testTimeout: 60_000,
  }
});

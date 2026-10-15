import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        // Unit and HTTP tests, with Prisma mocked: no database needed
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'] },
      },
      {
        // Real PostgreSQL (DATABASE_URL must point to a *_test database, migrated).
        // One worker: the files share the database and truncate it between tests
        test: {
          name: 'db',
          include: ['tests/db/**/*.test.ts'],
          setupFiles: ['tests/db/setup.ts'],
          fileParallelism: false,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Entry point only: listen() and process wiring
      exclude: ['src/index.ts'],
      reporter: ['text', 'json-summary', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      // Below these, the run fails (KAN-49)
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
  },
});

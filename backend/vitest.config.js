import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.js'],
    exclude: ['src/tests/integration/**', '**/node_modules/**'],
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.js'],
      exclude: ['src/tests/**', 'src/logs/**', '**/*.test.js'],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 85
      }
    }
  }
});


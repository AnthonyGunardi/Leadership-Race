import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/tests/integration/**/*.test.js'],
    exclude: ['**/node_modules/**'],
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 30000
  }
});


import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.js'],
    include: ['src/__tests__/**/*.test.{js,jsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/__tests__/**', '**/*.test.{js,jsx}'],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 85
      }
    }
  }
});


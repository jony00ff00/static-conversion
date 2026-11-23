import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Each render launches its own browser; keep parallelism modest.
    maxWorkers: 2,
  },
});

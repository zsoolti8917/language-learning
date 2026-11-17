import { defineProject } from 'vitest/config';

// Test databases (PGlite) start in about two seconds, slower when every package runs at once.
export default defineProject({
  test: {
    name: '@app/api',
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});

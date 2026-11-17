import { defineConfig } from 'vitest/config';

// One Vitest project per workspace package. A package may add its own
// vitest.config.ts (or vite.config.ts) to set its environment.
export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      'packages/*',
      'apps/*',
      'tools/*',
      {
        test: {
          name: 'root-scripts',
          include: ['scripts/**/*.test.{ts,mjs}'],
          environment: 'node',
        },
      },
    ],
  },
});

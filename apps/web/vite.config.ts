/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { msw } from 'msw/vite';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Client variables live in the repository root .env (see .env.example).
const envDir = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  // `--mode mock` (dev or build) is the same as VITE_MOCK_API=true.
  if (mode === 'mock') process.env.VITE_MOCK_API = 'true';
  const env = loadEnv(mode, envDir, 'VITE_');
  const mockApi = (process.env.VITE_MOCK_API ?? env.VITE_MOCK_API) === 'true';
  return {
    envDir,
    plugins: [
      react(),
      tailwindcss(),
      // Serves (and in a mock build emits) mockServiceWorker.js; the app starts it itself.
      mockApi && msw({ mode: 'worker-only' }),
      VitePWA({
        registerType: 'prompt',
        injectRegister: false,
        // In mock mode the mock worker owns the scope; the app does not register this one.
        manifest: {
          id: '/',
          name: 'Slovak',
          short_name: 'Slovak',
          description: 'Daily Slovak practice: reviews, reading, cases and a tutor.',
          lang: 'en',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#f6f6f4',
          theme_color: '#f6f6f4',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: '/icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon.svg'],
        workbox: {
          // The app shell only: HTML, scripts, styles, icons. API data is the app's own job.
          globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
          globIgnores: ['**/mockServiceWorker.js'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//, /^\/gallery/],
          cleanupOutdatedCaches: true,
        },
      }),
    ],
    server: {
      proxy: {
        // The local API (F5). API_URL overrides the address.
        '/api': process.env.API_URL ?? 'http://localhost:8787',
      },
    },
    build: {
      // The size budget check reads it (scripts/size-budget.mjs).
      manifest: true,
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      // Contract and DB code under test may run longer than the 5 s default on a cold start.
      testTimeout: 15_000,
    },
  };
});

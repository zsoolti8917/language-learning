// The mock server in the browser (VITE_MOCK_API=true). The msw/vite plugin serves the worker.
import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

export const worker = setupWorker(...handlers);

export async function startMockWorker(): Promise<void> {
  await worker.start({
    quiet: true,
    // Assets, fonts and the like pass through; only the API is mocked.
    onUnhandledFrame: 'bypass',
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
  });
}

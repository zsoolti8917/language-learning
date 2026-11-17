import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, createAppContext } from './app/App';
import { configureApi } from './lib/api';
import { outbox } from './lib/db';
import { registerServiceWorker } from './lib/pwa';
import { createAppRouter } from './routes';
import './index.css';

async function boot() {
  // Read the variable literally so a normal build drops the mock server entirely.
  if (import.meta.env.VITE_MOCK_API === 'true') {
    // The mock server and the app's service worker would claim the same scope; in mock mode
    // only the mock runs.
    const { startMockWorker } = await import('./mocks/browser');
    await startMockWorker();
  } else {
    void registerServiceWorker().catch((e) => console.warn('service worker', e));
  }
  if (import.meta.env.DEV) {
    const { warnOnDrift } = await import('./lib/api/validate');
    configureApi({ onResponse: warnOnDrift });
  }

  const context = createAppContext();
  const router = createAppRouter(context);
  // Outbox triggers: app start (now), online, foreground, each new write; manual via syncNow.
  outbox.start();

  const root = document.getElementById('root');
  if (root) {
    createRoot(root).render(
      <StrictMode>
        <App router={router} context={context} />
      </StrictMode>,
    );
  }
}

void boot();

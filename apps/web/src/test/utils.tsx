// Test utilities for feature packages.
//   renderRoute('/review')                  the whole app at a path, signed in, mock server on
//   renderWithProviders(<MyComponent />)    query client, login and toasts around one component
//   server.use(mockEndpoint(...))           override one endpoint for one test
//   freshDb()                               an empty local database of its own
import { QueryClientProvider } from '@tanstack/react-query';
import { type RenderResult, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { App, createAppContext } from '../app/App';
import { api } from '../lib/api';
import { type AuthClient, AuthProvider, createDevAuth } from '../lib/auth';
import { AuthStore } from '../lib/auth/store';
import { AppDb } from '../lib/db/db';
import { Outbox } from '../lib/db/outbox';
import { createQueryClient } from '../lib/query';
import { type AppRouter, createTestRouter, type RouterContext } from '../routes';
import { ToastProvider } from '../ui/Toast';

export {
  endpointPattern,
  exampleHandler,
  mockEndpoint,
  mockError,
  mockNetworkError,
  sseResponse,
} from '../mocks/handlers';
export { server } from '../mocks/node';

export interface ProviderOptions {
  /** 'signedIn' (default) uses the dev user; 'signedOut'; or a fake AuthClient. */
  auth?: 'signedIn' | 'signedOut' | AuthClient;
}

function authClientFor(auth: ProviderOptions['auth']): AuthClient {
  if (auth && typeof auth === 'object') return auth;
  return createDevAuth({ storage: null, signedIn: auth !== 'signedOut' });
}

/** Renders the full app (router, guards, tab bar) at `path`. Await `findBy…` for the screen. */
export function renderRoute(
  path: string,
  options: ProviderOptions = {},
): RenderResult & { router: AppRouter; context: RouterContext } {
  const context = createAppContext({ authClient: authClientFor(options.auth), retry: false });
  const router = createTestRouter(context, path);
  const result = render(<App router={router} context={context} />);
  return { ...result, router, context };
}

/** Renders a component with a fresh query client, the login store and the toast region. */
export function renderWithProviders(
  ui: ReactNode,
  options: ProviderOptions = {},
): RenderResult & { context: RouterContext } {
  const queryClient = createQueryClient({ retry: false });
  const auth = new AuthStore(authClientFor(options.auth));
  const context = { queryClient, auth };
  const result = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider store={auth}>
        <ToastProvider>{ui}</ToastProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...result, context };
}

let dbCounter = 0;

/** An empty local database with a unique name, so tests do not share rows. */
export function freshDb(): AppDb {
  dbCounter += 1;
  return new AppDb(`test-${dbCounter}-${Math.random().toString(36).slice(2)}`);
}

/** An outbox over a fresh database and the shared client (mock server in tests). */
export function testOutbox(options: Partial<ConstructorParameters<typeof Outbox>[0]> = {}) {
  return new Outbox({ api, db: freshDb(), ...options });
}

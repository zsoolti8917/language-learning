import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useEffect } from 'react';
import { configureApi } from '../lib/api';
import { type AuthClient, AuthProvider, createAuthClient } from '../lib/auth';
import { AuthStore } from '../lib/auth/store';
import { env } from '../lib/env';
import { createQueryClient } from '../lib/query';
import { t } from '../messages';
import type { AppRouter, RouterContext } from '../routes';
import { ToastProvider } from '../ui/Toast';

/** Builds the query client and the login store, and wires the API client to them. */
export function createAppContext(
  options: { authClient?: AuthClient; retry?: boolean } = {},
): RouterContext {
  const queryClient = createQueryClient({ retry: options.retry ?? true });
  const auth = new AuthStore(options.authClient ?? createAuthClient(env), {
    onSignOut: () => queryClient.clear(),
  });
  configureApi({
    getToken: () => auth.getToken(),
    onUnauthorized: () => auth.refreshAfterUnauthorized(),
  });
  return { queryClient, auth };
}

export function App({ router, context }: { router: AppRouter; context: RouterContext }) {
  // A change of login runs the guards again (sign out leaves a tab screen, for example).
  useEffect(() => context.auth.subscribe(() => void router.invalidate()), [context.auth, router]);
  return (
    <QueryClientProvider client={context.queryClient}>
      <AuthProvider store={context.auth}>
        <ToastProvider label={t('app.notifications')} closeLabel={t('app.close')}>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

import { QueryClient } from '@tanstack/react-query';
import { isApiError } from './api/errors';

/** The app's query client. Tests create a fresh one per render. */
export function createQueryClient(options: { retry?: boolean } = {}): QueryClient {
  const retry = options.retry ?? true;
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Fetch from the cache first and try the network even when the browser reports offline;
        // offline data the app needs lives in the local database, not here.
        networkMode: 'offlineFirst',
        retry: (count, error) =>
          retry && count < 2 && (!isApiError(error) || (error.isRetryable && !error.isNetwork)),
      },
      mutations: { networkMode: 'offlineFirst', retry: false },
    },
  });
}

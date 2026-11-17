// Loading, error and offline states of the screens that fetch data.
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { isApiError } from '../../lib/api';
import { Button, EmptyState, Skeleton } from '../../ui';
import { m } from './messages';

export function isOfflineError(error: unknown): boolean {
  return (
    (isApiError(error) && error.isNetwork) ||
    (typeof navigator !== 'undefined' && navigator.onLine === false)
  );
}

export function LoadingBlock({ lines = 3 }: { lines?: number }) {
  return (
    <div role="status" aria-busy="true" aria-label={m.t('state.loading')} className="space-y-3">
      <Skeleton className="h-6 w-2/3" />
      <Skeleton lines={lines} />
      <Skeleton className="h-24" />
    </div>
  );
}

export function ErrorBlock({
  error,
  onRetry,
  notFound,
}: {
  error: unknown;
  onRetry?: () => void;
  notFound?: string;
}) {
  const offline = isOfflineError(error);
  const missing = isApiError(error) && error.code === 'not_found';
  return (
    <div role="alert">
      <EmptyState
        title={missing && notFound ? notFound : offline ? m.t('state.offline') : m.t('state.error')}
        action={
          onRetry && !missing ? (
            <Button variant="secondary" onClick={onRetry}>
              {m.t('state.retry')}
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}

/** Renders `children(data)` once the query has data, else its loading or error state. */
export function QueryState<T>({
  query,
  children,
  notFound,
  lines,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
  notFound?: string;
  lines?: number;
}) {
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.isError) {
    return (
      <ErrorBlock
        error={query.error}
        onRetry={() => void query.refetch()}
        {...(notFound ? { notFound } : {})}
      />
    );
  }
  return <LoadingBlock {...(lines ? { lines } : {})} />;
}

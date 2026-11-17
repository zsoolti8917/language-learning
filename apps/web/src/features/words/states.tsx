// Loading, error and offline states shared by the screens of the words track.
import { isApiError } from '../../lib/api';
import { Button, EmptyState, Skeleton } from '../../ui';
import { m } from './messages';

export function LoadingState({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-busy="true" aria-label={m.t('common.loading')}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height="4.5rem" className="rounded-card" />
      ))}
    </div>
  );
}

/** True when the request never reached the server. */
export function isOfflineError(error: unknown): boolean {
  return (
    (isApiError(error) && error.isNetwork) ||
    (typeof navigator !== 'undefined' && navigator.onLine === false)
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const offline = isOfflineError(error);
  return (
    <div role="alert">
      <EmptyState
        title={offline ? m.t('common.offline') : m.t('common.error')}
        description={offline ? m.t('common.offlineHint') : undefined}
        action={
          <Button variant="secondary" onClick={onRetry}>
            {m.t('common.retry')}
          </Button>
        }
      />
    </div>
  );
}

// What the learner sees while a text is analysed, and when the analysis failed.
import type { ReactNode } from 'react';
import { Button, EmptyState, ProgressRing, Skeleton } from '../../ui';
import { m } from './messages';

export function TextProcessing() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-4 py-4">
      <EmptyState
        icon={
          <ProgressRing value={33} label={m.t('import.processingTitle')} size={48} thickness={5} />
        }
        title={m.t('import.processingTitle')}
        description={m.t('import.processingBody')}
      />
      <Skeleton lines={4} />
    </div>
  );
}

export function TextFailed({
  error,
  onRetry,
  retrying = false,
  extra,
}: {
  error?: string | null;
  onRetry: () => void;
  retrying?: boolean;
  extra?: ReactNode;
}) {
  return (
    <div role="alert" className="py-4">
      <EmptyState
        title={m.t('import.failedTitle')}
        description={error || m.t('import.failedBody')}
        action={
          <div className="flex flex-col items-center gap-2">
            <Button onClick={onRetry} loading={retrying}>
              {m.t('import.retry')}
            </Button>
            {extra}
          </div>
        }
      />
    </div>
  );
}

/** The share of known words as a small ring with the percent in the middle. */
export function CoverageRing({ share, size = 44 }: { share: number | null; size?: number }) {
  const p = share === null ? null : Math.round(share * 100);
  return (
    <ProgressRing
      value={p ?? 0}
      label={m.t('library.coverage')}
      valueText={
        p === null ? m.t('library.coverageUnknown') : m.t('library.coverageValue', { percent: p })
      }
      size={size}
      thickness={4}
    >
      {p === null ? null : <span className="text-xs">{p}</span>}
    </ProgressRing>
  );
}

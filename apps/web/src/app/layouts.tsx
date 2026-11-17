import { Link, Outlet } from '@tanstack/react-router';
import { t } from '../messages';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';
import { TabBar } from './TabBar';

/** Screens of the five tabs: content above the fixed tab bar. */
export function TabLayout() {
  return (
    <div className="min-h-dvh bg-bg text-fg">
      {/* 4.5rem leaves room for the tab bar; the safe area adds the home indicator. */}
      <main className="mx-auto max-w-xl pb-[calc(4.5rem+env(safe-area-inset-bottom))] pt-safe px-safe">
        <Outlet />
      </main>
      <TabBar />
    </div>
  );
}

/** Account screens and the first run: no tab bar. */
export function BareLayout() {
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <main className="mx-auto max-w-xl pb-safe pt-safe px-safe">
        <Outlet />
      </main>
    </div>
  );
}

export function PendingScreen() {
  return (
    <div className="space-y-3 px-gutter py-6" role="status" aria-label={t('app.loading')}>
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-24" />
    </div>
  );
}

export function NotFoundScreen() {
  return (
    <div className="px-gutter py-10">
      <EmptyState
        title={t('app.notFound')}
        action={
          <Link to="/" className="font-medium text-primary underline">
            {t('app.backHome')}
          </Link>
        }
      />
    </div>
  );
}

export function ErrorScreen({ error, reset }: { error: unknown; reset?: () => void }) {
  return (
    <div className="px-gutter py-10" role="alert">
      <EmptyState
        title={t('app.error')}
        description={error instanceof Error ? error.message : undefined}
        action={reset ? <Button onClick={reset}>{t('app.retry')}</Button> : undefined}
      />
    </div>
  );
}

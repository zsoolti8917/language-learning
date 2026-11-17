// The offline indicator and the update prompt. The tab layout (src/app/layouts.tsx) shows them
// above every tab screen. Imported by file, not through lib/pwa/index.ts, so the hooks stay
// usable without React components. Moved here from features/today/AppNotices.tsx (M1).
import { t } from '../../messages';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { useOnline, useUpdatePrompt } from './index';

export function OfflineIndicator() {
  const online = useOnline();
  if (online) return null;
  return (
    <p
      role="status"
      data-offline=""
      className="rounded-card border border-border-strong bg-surface-2 px-3 py-2 text-sm text-fg"
    >
      {t('notices.offline')}
    </p>
  );
}

export function UpdatePrompt() {
  const { needRefresh, update, dismiss } = useUpdatePrompt();
  if (!needRefresh) return null;
  return (
    <Card
      title={t('notices.updateTitle')}
      subtitle={t('notices.updateBody')}
      role="region"
      aria-label={t('notices.updateTitle')}
    >
      <div className="flex gap-2">
        <Button onClick={() => void update()}>{t('notices.updateAction')}</Button>
        <Button variant="ghost" onClick={dismiss}>
          {t('notices.updateLater')}
        </Button>
      </div>
    </Card>
  );
}

/** Both notices in a column; renders nothing (and takes no room) when neither shows. */
export function PwaNotices({ className }: { className?: string }) {
  return (
    <div className={`flex flex-col gap-3 empty:hidden ${className ?? ''}`}>
      <OfflineIndicator />
      <UpdatePrompt />
    </div>
  );
}

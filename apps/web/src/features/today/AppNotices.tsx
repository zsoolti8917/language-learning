// The offline indicator, the update prompt and the one time iOS install hint (lib/pwa hooks).
// Shown at the top of Today and Settings; the shell has no global slot for them.
import { type PlatformInfo, useIosInstallHint, useOnline, useUpdatePrompt } from '../../lib/pwa';
import { Button, Card } from '../../ui';
import { m } from './messages';

export function OfflineIndicator() {
  const online = useOnline();
  if (online) return null;
  return (
    <p
      role="status"
      data-offline=""
      className="rounded-card border border-border-strong bg-surface-2 px-3 py-2 text-sm text-fg"
    >
      {m.t('notices.offline')}
    </p>
  );
}

export function UpdatePrompt() {
  const { needRefresh, update, dismiss } = useUpdatePrompt();
  if (!needRefresh) return null;
  return (
    <Card
      title={m.t('notices.updateTitle')}
      subtitle={m.t('notices.updateBody')}
      role="region"
      aria-label={m.t('notices.updateTitle')}
    >
      <div className="flex gap-2">
        <Button onClick={() => void update()}>{m.t('notices.updateAction')}</Button>
        <Button variant="ghost" onClick={dismiss}>
          {m.t('notices.updateLater')}
        </Button>
      </div>
    </Card>
  );
}

export function IosInstallHint({ platform }: { platform?: PlatformInfo }) {
  const { show, dismiss } = useIosInstallHint(platform);
  if (!show) return null;
  return (
    <Card
      title={m.t('notices.iosTitle')}
      subtitle={m.t('notices.iosBody')}
      role="region"
      aria-label={m.t('notices.iosTitle')}
    >
      <Button variant="secondary" onClick={dismiss}>
        {m.t('notices.iosDismiss')}
      </Button>
    </Card>
  );
}

export function AppNotices({ platform }: { platform?: PlatformInfo }) {
  return (
    <div className="flex flex-col gap-3 empty:hidden">
      <OfflineIndicator />
      <UpdatePrompt />
      <IosInstallHint platform={platform} />
    </div>
  );
}

// The one time iOS install hint (lib/pwa hook), shown at the top of Today and Settings.
// The offline indicator and the update prompt moved to lib/pwa/notices.tsx: the tab layout
// shows them above every tab screen. They are re-exported here for older imports.
import { type PlatformInfo, useIosInstallHint } from '../../lib/pwa';
import { Button, Card } from '../../ui';
import { m } from './messages';

export { OfflineIndicator, UpdatePrompt } from '../../lib/pwa/notices';

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
      <IosInstallHint platform={platform} />
    </div>
  );
}

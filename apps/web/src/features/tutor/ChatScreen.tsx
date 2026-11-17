// Placeholder from F6. The owning feature package replaces it and keeps the export name.
import { useParams } from '@tanstack/react-router';
import { Placeholder } from '../../app/Placeholder';
import { t } from '../../messages';

export function ChatScreen() {
  const { conversationId } = useParams({ strict: false });
  return (
    <Placeholder title={t('screens.chat')} params={{ conversationId: String(conversationId) }} />
  );
}

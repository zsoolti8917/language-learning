// Saving lesson progress: straight to the API when online, through the outbox otherwise.
import type { LessonProgress, SaveLessonProgress } from '@app/contracts';
import { api, isApiError } from '../../lib/api';
import { outbox as appOutbox, type Outbox } from '../../lib/db';

/**
 * Saves `body` for lesson `id`. Returns the server's progress, or null when the write waits
 * in the outbox (offline) or the server refused it.
 */
export async function saveProgress(
  id: string,
  body: SaveLessonProgress,
  target: Outbox = appOutbox,
): Promise<LessonProgress | null> {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (!offline) {
    try {
      return await api.declension.saveProgress({ params: { id }, body });
    } catch (e) {
      if (!(isApiError(e) && (e.isNetwork || e.isRetryable))) return null;
    }
  }
  await target.enqueue('declension.saveProgress', { params: { id }, body }, { merge: false });
  target.flush().catch(() => {});
  return null;
}

// AttemptsPort of the declension module (B5): every graded case form, whichever screen it came
// from, goes to `app.attempt`; mastery per bucket is computed from it on request.

import { currentUserId } from '../../platform/tx';
import type { AttemptsPort, PortContext } from '../../ports';
import * as repo from './repo';
import { getMastery } from './service';

export function createAttemptsPort(ctx: PortContext): AttemptsPort {
  return {
    async record(tx, attempts) {
      if (attempts.length === 0) return;
      const userId = await currentUserId(tx);
      const now = ctx.clock.now();
      // A client time in the future is set to the server time.
      await repo.insertAttempts(
        tx,
        userId,
        attempts.map((a) =>
          Date.parse(a.occurredAt) > now.getTime() ? { ...a, occurredAt: now.toISOString() } : a,
        ),
      );
    },
    async getMastery(tx) {
      return getMastery(tx, await currentUserId(tx));
    },
  };
}

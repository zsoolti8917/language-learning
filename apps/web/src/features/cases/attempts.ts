// Attempts of the trainer and the lesson player, sent through the outbox
// (docs/contracts.md, AttemptInput). Waiting batches merge in the outbox, and every attempt
// carries its own client id, so a repeat is harmless.
import type { AttemptInput, Diagnosis, SubmitAttemptsResult } from '@app/contracts';
import { outbox as appOutbox, kvGet, kvSet, type Outbox, registerApplier } from '../../lib/db';
import { newId } from '../../lib/ids';

/** Items per batch: attempts go out every five items and at the end. */
export const BATCH_ITEMS = 5;

export function makeAttempt(input: {
  exerciseId: string;
  source: 'trainer' | 'lesson';
  sessionId?: string | undefined;
  typed: string;
  correct: boolean;
  retry: boolean;
  diagnosis: Diagnosis;
  durationMs: number;
  now?: Date;
}): AttemptInput {
  return {
    id: newId(),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    source: input.source,
    exerciseId: input.exerciseId,
    typed: input.typed,
    correct: input.correct,
    retry: input.retry,
    clientDiagnosis: input.diagnosis,
    occurredAt: (input.now ?? new Date()).toISOString(),
    durationMs: Math.max(0, Math.round(input.durationMs)),
  };
}

/** The result of one finished item: its one or two attempts. */
export interface ItemResult {
  exerciseId: string;
  attempts: AttemptInput[];
}

/**
 * Which attempts to send now: those of the finished items not sent yet, once five items are
 * waiting, or all of them at the end. Returns the new count of sent items.
 */
export function dueBatch(
  results: readonly ItemResult[],
  sentItems: number,
  final: boolean,
): { attempts: AttemptInput[]; sentItems: number } {
  const waiting = results.length - sentItems;
  if (waiting <= 0 || (!final && waiting < BATCH_ITEMS)) return { attempts: [], sentItems };
  const upTo = final ? results.length : sentItems + Math.floor(waiting / BATCH_ITEMS) * BATCH_ITEMS;
  return {
    attempts: results.slice(sentItems, upTo).flatMap((r) => r.attempts),
    sentItems: upTo,
  };
}

/** Puts attempts in the outbox and tries to send them now. */
export async function sendAttempts(
  attempts: AttemptInput[],
  target: Outbox = appOutbox,
): Promise<void> {
  if (attempts.length === 0) return;
  await target.enqueue('declension.submitAttempts', { body: { attempts } });
  // The outbox sends by itself once started; this covers a screen opened before the start.
  target.flush().catch(() => {});
}

// --- Mastery after a sent batch -------------------------------------------------------------

export const MASTERY_KV_KEY = 'cases.mastery.latest';

export interface LatestMastery {
  /** Epoch ms when the answer arrived. */
  at: number;
  /** Ids of the attempts the server took with this answer. */
  attemptIds: string[];
  mastery: SubmitAttemptsResult['mastery'];
}

/** Keeps the mastery of the server's latest answer, so the trainer summary can compare. */
export async function storeMastery(
  response: SubmitAttemptsResult,
  attempts: readonly AttemptInput[],
  database?: Parameters<typeof kvSet>[2],
): Promise<void> {
  const previous = await kvGet<LatestMastery>(MASTERY_KV_KEY, database);
  // Merge by bucket: a later batch may report other buckets than an earlier one.
  const byKey = new Map(
    (previous?.mastery ?? []).map((b) => [`${b.case}.${b.number}.${b.gender}`, b] as const),
  );
  for (const b of response.mastery) byKey.set(`${b.case}.${b.number}.${b.gender}`, b);
  const value: LatestMastery = {
    at: Date.now(),
    attemptIds: [...(previous?.attemptIds ?? []), ...attempts.map((a) => a.id)].slice(-400),
    mastery: [...byKey.values()],
  };
  await kvSet(MASTERY_KV_KEY, value, database);
}

registerApplier('declension.submitAttempts', (response, input, database) =>
  storeMastery(response, input.body.attempts, database),
);

// Sorting decisions (Known, Learn, Ignore) go to the outbox in batches of 20. The newest
// decisions wait in a batch of their own until the next one would make it 21, so the last
// decision can always be undone. Leaving the sorting mode sends what waits.
import type { LemmaStatus, TriageDecision } from '@app/contracts';
import { type AppDb, db as defaultDb, kvGet, kvSet, type Outbox, outbox } from '../../lib/db';

export const TRIAGE_BATCH_SIZE = 20;
const WAITING_KEY = 'words.triage.waiting';

export interface WaitingDecision {
  lemmaId: number;
  decision: TriageDecision;
  /** The local status before the decision, restored by undo. */
  previous: LemmaStatus | null;
}

/** The status a decision gives a word on the server. */
export const STATUS_OF_DECISION: Record<TriageDecision, LemmaStatus> = {
  known: 'known',
  learn: 'learning',
  ignored: 'ignored',
};

export interface TriageBatcherOptions {
  outbox?: Outbox;
  db?: AppDb;
  size?: number;
}

export class TriageBatcher {
  private readonly outbox: Outbox;
  private readonly db: AppDb;
  private readonly size: number;
  private waiting: WaitingDecision[] = [];
  /** Serialises every change, so fast taps never interleave. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(options: TriageBatcherOptions = {}) {
    this.outbox = options.outbox ?? outbox;
    this.db = options.db ?? this.outbox.db ?? defaultDb;
    this.size = options.size ?? TRIAGE_BATCH_SIZE;
  }

  /** Decisions not yet handed to the outbox, oldest first. */
  get pending(): readonly WaitingDecision[] {
    return this.waiting;
  }

  /**
   * Picks up a batch left behind by a closed tab or a crash and sends it. Call once before
   * the first decision.
   */
  recover(): Promise<number> {
    return this.run(async () => {
      const left = (await kvGet<WaitingDecision[]>(WAITING_KEY, this.db)) ?? [];
      if (left.length === 0) return 0;
      this.waiting = left;
      return this.send();
    });
  }

  /** Records one decision and its local status. Sends the full batch before a 21st waits. */
  decide(lemmaId: number, decision: TriageDecision): Promise<void> {
    return this.run(async () => {
      if (this.waiting.length >= this.size) await this.send();
      const previous = (await this.db.lemmaStatus.get(lemmaId))?.status ?? null;
      this.waiting.push({ lemmaId, decision, previous });
      await this.db.lemmaStatus.put({
        lemmaId,
        status: STATUS_OF_DECISION[decision],
        updatedAt: new Date().toISOString(),
      });
      await this.save();
    });
  }

  /** Takes the last decision out of the waiting batch. Null when nothing waits. */
  undo(): Promise<WaitingDecision | null> {
    return this.run(async () => {
      const last = this.waiting.pop();
      if (!last) return null;
      if (last.previous) {
        await this.db.lemmaStatus.put({
          lemmaId: last.lemmaId,
          status: last.previous,
          updatedAt: new Date().toISOString(),
        });
      } else {
        await this.db.lemmaStatus.delete(last.lemmaId);
      }
      await this.save();
      return last;
    });
  }

  /** Leaving the sorting mode: the waiting batch goes to the outbox, however small. */
  leave(): Promise<number> {
    return this.run(() => this.send());
  }

  private async send(): Promise<number> {
    const batch = this.waiting;
    if (batch.length === 0) return 0;
    this.waiting = [];
    // Each batch stays its own outbox item, so batches of 20 never merge into one.
    await this.outbox.enqueue(
      'words.triage',
      { body: { decisions: batch.map(({ lemmaId, decision }) => ({ lemmaId, decision })) } },
      { merge: false },
    );
    await this.save();
    return batch.length;
  }

  private save(): Promise<void> {
    return kvSet(WAITING_KEY, this.waiting, this.db);
  }

  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task, task);
    this.chain = next.catch(() => {});
    return next;
  }
}

// The outbox (docs/architecture.md, "State and offline"). Writes wait here with the ids the
// client gave them and go out in order. Five triggers send it: app start, the connection
// returning, the app coming to the foreground, each new write, and a manual sync.
// iOS has no background sync, so nothing relies on one.
import type { EndpointName } from '@app/contracts';
import type { ApiClient, ApiInput, ApiResult } from '../api/client';
import { ApiError } from '../api/errors';
import { newId } from '../ids';
import { type AppDb, db as defaultDb, type OutboxRow } from './db';
import { applyCardSnapshots, applyTextSummary, setLemmaStatuses } from './store';

// --- Mergers: batch endpoints collect waiting items into one request ----------------------

type Merger<N extends EndpointName> = (
  waiting: ApiInput<N>,
  next: ApiInput<N>,
) => ApiInput<N> | null;

const MAX_BATCH = 200;

function concatBody<N extends EndpointName, K extends string>(key: K): Merger<N> {
  return (a, b) => {
    const ab = (a as { body: Record<K, unknown[]> }).body;
    const bb = (b as { body: Record<K, unknown[]> }).body;
    if (ab[key].length + bb[key].length > MAX_BATCH) return null;
    return { ...(a as object), body: { ...ab, [key]: [...ab[key], ...bb[key]] } } as ApiInput<N>;
  };
}

const mergers: { [N in EndpointName]?: Merger<N> } = {
  'review.submitAnswers': concatBody('answers'),
  'declension.submitAttempts': concatBody('attempts'),
  'words.triage': concatBody('decisions'),
};

/** Adds or replaces how waiting items of one endpoint merge. Return null to keep them apart. */
export function registerMerger<N extends EndpointName>(name: N, merge: Merger<N>): void {
  (mergers as Record<string, unknown>)[name] = merge;
}

// --- Appliers: the server's answer replaces local state -----------------------------------

type Applier<N extends EndpointName> = (
  response: ApiResult<N>,
  input: ApiInput<N>,
  database: AppDb,
) => Promise<void> | void;

const appliers: { [N in EndpointName]?: Applier<N> } = {
  'review.submitAnswers': (res, _input, database) =>
    applyCardSnapshots(
      res.results.map((r) => r.card),
      database,
    ),
  'lemmas.setStatus': (res, _input, database) =>
    setLemmaStatuses([{ lemmaId: res.lemmaId, status: res.status }], database),
  'texts.update': (res, _input, database) => applyTextSummary(res, database),
};

/** Registers what to do with the answer of a sent item, for endpoints the defaults miss. */
export function registerApplier<N extends EndpointName>(name: N, apply: Applier<N>): void {
  (appliers as Record<string, unknown>)[name] = apply;
}

// --- The outbox ---------------------------------------------------------------------------

export interface OutboxState {
  /** Items waiting, including ones waiting for a retry. */
  pending: number;
  /** Items the server refused for good (a 4xx other than 401, 408 and 429). */
  failed: number;
  syncing: boolean;
  /** Epoch ms of the last flush that reached the server. */
  lastSyncAt: number | null;
}

export interface FlushReport {
  sent: number;
  retrying: number;
  failed: number;
  /** Why the run stopped early: offline, the network failed, or the login needs a refresh. */
  stopped?: 'offline' | 'network' | 'unauthorized';
}

export interface OutboxOptions {
  db?: AppDb;
  /** Anything with the client's `call`. */
  api: Pick<ApiClient, 'call'>;
  now?: () => number;
  isOnline?: () => boolean;
  /** Delay before retry number `attempts` (1, 2, …), in ms. */
  backoff?: (attempts: number) => number;
}

export interface EnqueueOptions {
  /** Merge into a waiting item of the same batch endpoint (default true). */
  merge?: boolean;
}

const defaultBackoff = (attempts: number) => Math.min(5 * 60_000, 2_000 * 2 ** (attempts - 1));

export class Outbox {
  readonly db: AppDb;
  private readonly api: OutboxOptions['api'];
  private readonly now: () => number;
  private readonly isOnline: () => boolean;
  private readonly backoff: (attempts: number) => number;
  private running: Promise<FlushReport> | null = null;
  private again = false;
  private started = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private state: OutboxState = { pending: 0, failed: 0, syncing: false, lastSyncAt: null };
  private readonly listeners = new Set<() => void>();

  constructor(options: OutboxOptions) {
    this.db = options.db ?? defaultDb;
    this.api = options.api;
    this.now = options.now ?? Date.now;
    this.isOnline =
      options.isOnline ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false);
    this.backoff = options.backoff ?? defaultBackoff;
  }

  /** Puts a write in the outbox and (once started) sends it at once if possible. */
  async enqueue<N extends EndpointName>(
    name: N,
    input: ApiInput<N>,
    options: EnqueueOptions = {},
  ): Promise<OutboxRow<N>> {
    const merge = options.merge !== false ? (mergers[name] as Merger<N> | undefined) : undefined;
    const table = this.db.outbox;
    const row = await this.db.transaction('rw', table, async () => {
      if (merge) {
        const last = await table.orderBy('seq').last();
        if (last && last.name === name && last.status === 'pending' && last.attempts === 0) {
          const merged = merge(last.input as ApiInput<N>, input);
          if (merged) {
            await table.update(last.seq as number, { input: merged as ApiInput<EndpointName> });
            return { ...last, input: merged } as OutboxRow<N>;
          }
        }
      }
      const fresh: OutboxRow<N> = {
        id: newId(),
        name,
        input,
        createdAt: new Date(this.now()).toISOString(),
        status: 'pending',
        attempts: 0,
        nextAttemptAt: 0,
      };
      const seq = await table.add(fresh as OutboxRow);
      return { ...fresh, seq };
    });
    await this.refresh();
    if (this.started) queueMicrotask(() => this.kick());
    return row;
  }

  /**
   * Sends every due item in order. One run at a time: a call during a run schedules one more
   * run after it, so an item is never sent twice at once.
   */
  flush(): Promise<FlushReport> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      let total: FlushReport = { sent: 0, retrying: 0, failed: 0 };
      try {
        do {
          this.again = false;
          const r = await this.runOnce();
          total = {
            sent: total.sent + r.sent,
            retrying: r.retrying,
            failed: total.failed + r.failed,
            ...(r.stopped ? { stopped: r.stopped } : {}),
          };
          // A trigger that fired during the run (the connection came back) earns another run.
        } while (this.again);
      } finally {
        this.running = null;
        this.setState({ syncing: false });
        await this.refresh();
        this.scheduleRetry();
      }
      return total;
    })();
    return this.running;
  }

  private async runOnce(): Promise<FlushReport> {
    const report: FlushReport = { sent: 0, retrying: 0, failed: 0 };
    if (!this.isOnline()) return { ...report, stopped: 'offline' };
    const table = this.db.outbox;
    const due = (await table.where('status').equals('pending').sortBy('seq')).filter(
      (r) => r.nextAttemptAt <= this.now(),
    );
    if (due.length === 0) return report;
    this.setState({ syncing: true });
    for (const candidate of due) {
      const seq = candidate.seq as number;
      // Take the item: it may have been merged into or removed since the list was read.
      const item = await this.db.transaction('rw', table, async () => {
        const r = await table.get(seq);
        if (r?.status !== 'pending') return undefined;
        await table.update(seq, { status: 'sending' });
        return r;
      });
      if (!item) continue;
      try {
        const call = this.api.call as (name: EndpointName, input: unknown) => Promise<unknown>;
        const res = await call(item.name, item.input);
        const apply = appliers[item.name] as Applier<EndpointName> | undefined;
        await apply?.(res as never, item.input, this.db);
        await table.delete(seq);
        report.sent++;
        this.setState({ lastSyncAt: this.now() });
      } catch (e) {
        const err = e instanceof ApiError ? e : null;
        const lastError = {
          status: err?.status ?? 0,
          code: err?.code ?? 'internal',
          message: e instanceof Error ? e.message : String(e),
        };
        if (err?.isNetwork || err?.status === 401) {
          // Nothing reaches the server now: everything waits, nothing counts as an attempt.
          await table.update(seq, { status: 'pending', lastError });
          return { ...report, stopped: err.isNetwork ? 'network' : 'unauthorized' };
        }
        if (!err || err.isRetryable) {
          const attempts = item.attempts + 1;
          const wait = err?.retryAfterSeconds
            ? err.retryAfterSeconds * 1000
            : this.backoff(attempts);
          await table.update(seq, {
            status: 'pending',
            attempts,
            nextAttemptAt: this.now() + wait,
            lastError,
          });
          report.retrying++;
        } else {
          await table.update(seq, { status: 'failed', attempts: item.attempts + 1, lastError });
          report.failed++;
        }
      }
    }
    return report;
  }

  /** Attaches the triggers: start, online, foreground and (via enqueue) each new write. */
  start(target: Window | undefined = typeof window === 'undefined' ? undefined : window) {
    if (this.started) return () => {};
    this.started = true;
    const onOnline = () => this.kick();
    const onVisible = () => {
      if (target?.document.visibilityState === 'visible') this.kick();
    };
    target?.addEventListener('online', onOnline);
    target?.document.addEventListener('visibilitychange', onVisible);
    // An item left `sending` by a closed tab goes out again; the server ignores repeats.
    void this.db.outbox
      .where('status')
      .equals('sending')
      .modify({ status: 'pending' })
      .then(
        () => this.kick(),
        () => {},
      );
    return () => {
      this.started = false;
      target?.removeEventListener('online', onOnline);
      target?.document.removeEventListener('visibilitychange', onVisible);
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = null;
    };
  }

  /** Manual sync, for a pull to refresh or a button. Also retries refused items. */
  async syncNow(options: { includeFailed?: boolean } = {}): Promise<FlushReport> {
    if (options.includeFailed) {
      await this.db.outbox
        .where('status')
        .equals('failed')
        .modify({ status: 'pending', nextAttemptAt: 0 });
    }
    await this.db.outbox.where('status').equals('pending').modify({ nextAttemptAt: 0 });
    return this.flush();
  }

  /** Drops one item for good (a refused write the learner gives up on). */
  async discard(seq: number): Promise<void> {
    await this.db.outbox.delete(seq);
    await this.refresh();
  }

  list(): Promise<OutboxRow[]> {
    return this.db.outbox.orderBy('seq').toArray();
  }

  getState = (): OutboxState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    this.refresh().catch(() => {});
    return () => this.listeners.delete(listener);
  };

  private scheduleRetry() {
    if (!this.started) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    void this.db.outbox
      .where('status')
      .equals('pending')
      .toArray()
      .then((rows) => {
        const next = Math.min(...rows.map((r) => r.nextAttemptAt));
        if (!Number.isFinite(next) || !this.started) return;
        const delay = Math.max(0, next - this.now());
        if (delay > 0) this.retryTimer = setTimeout(() => this.kick(), delay);
      })
      .catch(() => {});
  }

  /** A flush started by a trigger: nobody awaits it, so a failure (closed database) is dropped. */
  private kick() {
    this.flush().catch(() => {});
  }

  private async refresh() {
    const [pending, failed] = await Promise.all([
      this.db.outbox.where('status').anyOf('pending', 'sending').count(),
      this.db.outbox.where('status').equals('failed').count(),
    ]);
    this.setState({ pending, failed });
  }

  private setState(patch: Partial<OutboxState>) {
    const next = { ...this.state, ...patch };
    if (
      next.pending === this.state.pending &&
      next.failed === this.state.failed &&
      next.syncing === this.state.syncing &&
      next.lastSyncAt === this.state.lastSyncAt
    ) {
      return;
    }
    this.state = next;
    for (const l of this.listeners) l();
  }
}

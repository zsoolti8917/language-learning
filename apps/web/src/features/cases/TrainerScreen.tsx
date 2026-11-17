// The trainer: a start screen with mode and size, a session over the fetched items graded on
// the phone, attempts sent every five items and at the end, and a summary of the buckets.
// A started session lives in the local database, so it finishes offline and survives a reload.
import type { BucketMastery, Course, SessionMode, TrainerSession } from '@app/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { api, apiKey } from '../../lib/api';
import { kvDelete, kvGet, kvSet, useOutbox } from '../../lib/db';
import { useOnline } from '../../lib/pwa';
import { t } from '../../messages';
import { Button, buttonClasses, Card, CaseBadge, cn, EmptyState, ProgressRing } from '../../ui';
import {
  dueBatch,
  type ItemResult,
  type LatestMastery,
  MASTERY_KV_KEY,
  sendAttempts,
} from './attempts';
import { ExerciseView } from './ExerciseView';
import { LevelLabel } from './MasteryGrid';
import { type BucketSummary, itemScore, summarize } from './mastery';
import { m } from './messages';
import { LoadingBlock } from './QueryState';

export const RUN_KV_KEY = 'cases.trainer.run';
export const SIZES = [5, 10, 20] as const;
const MODES: SessionMode[] = ['lesson', 'mixed', 'weak'];

export interface TrainerRun {
  session: TrainerSession;
  mode: SessionMode;
  startedAt: string;
  index: number;
  results: ItemResult[];
  /** Items whose attempts are in the outbox already. */
  sentItems: number;
  /** Mastery of the session's buckets before it started, from the course. */
  before: BucketMastery[];
  finished: boolean;
}

function currentLessonId(course: Course | undefined): string | undefined {
  const lessons = [...(course?.lessons ?? [])].sort((a, b) => a.ord - b.ord);
  return (
    lessons.find((l) => l.status === 'in_progress') ?? lessons.find((l) => l.status === 'available')
  )?.id;
}

// --- Start screen -----------------------------------------------------------------------------

function Choice<T extends string | number>({
  legend,
  options,
  value,
  onChange,
  label,
  hint,
}: {
  legend: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  label: (v: T) => string;
  hint?: (v: T) => string;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-base font-semibold text-fg">{legend}</legend>
      <div className="grid gap-2">
        {options.map((o) => (
          <Button
            key={String(o)}
            variant={o === value ? 'primary' : 'secondary'}
            aria-pressed={o === value}
            block
            className="flex-col items-start text-left"
            onClick={() => onChange(o)}
          >
            <span>{label(o)}</span>
            {hint && <span className="text-sm font-normal opacity-90">{hint(o)}</span>}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}

function Setup({
  saved,
  onResume,
  onDiscard,
  onStart,
}: {
  saved: TrainerRun | null;
  onResume: () => void;
  onDiscard: () => void;
  onStart: (run: TrainerRun) => void;
}) {
  const queryClient = useQueryClient();
  const online = useOnline();
  const [mode, setMode] = useState<SessionMode>('mixed');
  const [size, setSize] = useState<number>(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const course = queryClient.getQueryData<Course>(apiKey('declension.course'));
      const lessonId = mode === 'lesson' ? currentLessonId(course) : undefined;
      const session = await api.declension.createSession({
        body: { mode, size, ...(lessonId ? { lessonId } : {}) },
      });
      if (session.items.length === 0) {
        setError(m.t('trainer.empty'));
        return;
      }
      onStart({
        session,
        mode,
        startedAt: new Date().toISOString(),
        index: 0,
        results: [],
        sentItems: 0,
        before: course?.mastery ?? [],
        finished: false,
      });
    } catch {
      setError(
        navigator.onLine === false ? m.t('trainer.offlineStart') : m.t('trainer.startFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {saved && !saved.finished && (
        <Card title={m.t('trainer.resume')} data-testid="resume">
          <p className="text-base text-fg-muted">
            {m.t('trainer.resumeHint', {
              done: saved.results.length,
              total: saved.session.items.length,
            })}
          </p>
          <div className="mt-3 grid gap-2">
            <Button block onClick={onResume}>
              {m.t('trainer.resume')}
            </Button>
            <Button block variant="ghost" onClick={onDiscard}>
              {m.t('trainer.discard')}
            </Button>
          </div>
        </Card>
      )}
      <h2 className="text-xl font-semibold text-fg">{m.t('trainer.setupTitle')}</h2>
      <Choice
        legend={m.t('trainer.modeLabel')}
        options={MODES}
        value={mode}
        onChange={setMode}
        label={(v) => m.t(`mode.${v}`)}
        hint={(v) => m.t(`modeHint.${v}`)}
      />
      <Choice
        legend={m.t('trainer.sizeLabel')}
        options={SIZES}
        value={size as (typeof SIZES)[number]}
        onChange={setSize}
        label={(v) => m.t('trainer.sizeOption', { count: v })}
      />
      {!online && (
        <p role="status" className="text-base text-fg">
          {m.t('trainer.offlineStart')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-base text-wrong">
          {error}
        </p>
      )}
      <Button
        block
        size="lg"
        loading={busy}
        disabled={busy || !online}
        onClick={() => void start()}
      >
        {busy ? m.t('trainer.starting') : m.t('trainer.start')}
      </Button>
    </div>
  );
}

// --- Running session ----------------------------------------------------------------------

function Running({
  run,
  onItemDone,
  onQuit,
}: {
  run: TrainerRun;
  onItemDone: (result: ItemResult) => void;
  onQuit: () => void;
}) {
  const items = run.session.items;
  const item = items[run.index];
  if (!item) return null;
  const last = run.index === items.length - 1;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p
          className="text-sm font-medium text-fg"
          aria-live="polite"
          data-testid="trainer-progress"
        >
          {m.t('trainer.progress', { current: run.index + 1, total: items.length })}
        </p>
        <div className="flex items-center gap-2">
          <CaseBadge
            case={item.features.case}
            variant="short"
            label={m.t(`caseTitle.${item.features.case}`)}
          />
          <Button variant="ghost" onClick={onQuit}>
            {m.t('trainer.quit')}
          </Button>
        </div>
      </div>
      <ExerciseView
        key={`${item.exerciseId}-${run.index}`}
        item={item}
        source="trainer"
        sessionId={run.session.sessionId}
        nextLabel={last ? m.t('item.finish') : m.t('item.next')}
        onDone={(r) => onItemDone({ exerciseId: r.exerciseId, attempts: r.attempts })}
      />
    </div>
  );
}

// --- Summary --------------------------------------------------------------------------------

function BucketList({
  list,
  empty,
  testId,
}: {
  list: BucketSummary[];
  empty: string;
  testId: string;
}) {
  if (list.length === 0) return <p className="text-base text-fg-muted">{empty}</p>;
  return (
    <ul className="space-y-2" data-testid={testId}>
      {list.map((b) => (
        <li
          key={b.key}
          className="flex items-center justify-between gap-2 rounded-control border border-border px-3 py-2"
          data-bucket={b.key}
        >
          <span className="flex flex-col gap-1">
            <CaseBadge
              case={b.case}
              label={m.t(`caseTitle.${b.case}`)}
              suffix={m.t(`numberShort.${b.number}`)}
            />
            <span className="text-sm text-fg-muted">
              {m.t(`genderTitle.${b.gender}`)} ·{' '}
              {m.t('trainer.sessionScore', { percent: Math.round(b.sessionScore * 100) })}
            </span>
          </span>
          {(b.after ?? b.before) && <LevelLabel level={(b.after ?? b.before)?.level ?? 'unseen'} />}
        </li>
      ))}
    </ul>
  );
}

function Summary({ run, onAgain }: { run: TrainerRun; onAgain: () => void }) {
  const { pending, lastSyncAt } = useOutbox();
  const ids = run.results.flatMap((r) => r.attempts.map((a) => a.id));
  const latest = useQuery({
    queryKey: ['cases', 'mastery', run.session.sessionId, pending, lastSyncAt],
    queryFn: async () => (await kvGet<LatestMastery>(MASTERY_KV_KEY)) ?? null,
    networkMode: 'always',
  });
  const seen = new Set(latest.data?.attemptIds ?? []);
  const after = ids.some((id) => seen.has(id)) ? (latest.data?.mastery ?? null) : null;
  // Saved means the server answered for every attempt of this session.
  const synced = ids.every((id) => seen.has(id));
  const { improved, weak } = summarize(run.session.items, run.results, run.before, after);
  const firstTry = run.results.filter((r) => itemScore(r) === 1).length;
  const score = { correct: firstTry, total: run.results.length };
  return (
    <div className="space-y-5" data-testid="trainer-summary">
      <div className="space-y-3 text-center">
        <h2 className="text-xl font-semibold text-fg">{m.t('trainer.summaryTitle')}</h2>
        <div className="flex justify-center">
          <ProgressRing
            value={score.correct}
            max={Math.max(1, score.total)}
            label={m.t('trainer.summaryScore', score)}
            valueText={m.t('course.score', score)}
          >
            {m.t('course.score', score)}
          </ProgressRing>
        </div>
        <p className="text-base text-fg">{m.t('trainer.summaryScore', score)}</p>
      </div>
      <Card title={m.t('trainer.improved')}>
        <BucketList list={improved} empty={m.t('trainer.noneImproved')} testId="improved" />
      </Card>
      <Card title={m.t('trainer.stillWeak')}>
        <BucketList list={weak} empty={m.t('trainer.noneWeak')} testId="weak" />
      </Card>
      <p role="status" className="text-sm text-fg-muted" data-testid="sync-state">
        {synced ? m.t('trainer.synced') : m.t('trainer.syncing')}
      </p>
      <div className="grid gap-2">
        <Button block onClick={onAgain}>
          {m.t('trainer.again')}
        </Button>
        <Link to="/cases" className={buttonClasses({ block: true, variant: 'secondary' })}>
          {m.t('trainer.backToCourse')}
        </Link>
      </div>
    </div>
  );
}

// --- Screen ---------------------------------------------------------------------------------

type View =
  | { kind: 'loading' }
  | { kind: 'setup'; saved: TrainerRun | null }
  | { kind: 'run'; run: TrainerRun };

/** Applies one finished item: sends a due batch, stores the run. Exported for tests. */
export function advance(run: TrainerRun, result: ItemResult, final = false): TrainerRun {
  const results = [...run.results, result];
  const finished = final || results.length >= run.session.items.length;
  const batch = dueBatch(results, run.sentItems, finished);
  void sendAttempts(batch.attempts);
  return {
    ...run,
    results,
    index: Math.min(run.index + 1, run.session.items.length - 1),
    sentItems: batch.sentItems,
    finished,
  };
}

export function TrainerScreen() {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const queryClient = useQueryClient();

  useEffect(() => {
    let live = true;
    kvGet<TrainerRun>(RUN_KV_KEY)
      .catch(() => undefined)
      .then((saved) => {
        if (!live) return;
        setView({ kind: 'setup', saved: saved && !saved.finished ? saved : null });
      });
    return () => {
      live = false;
    };
  }, []);

  function show(run: TrainerRun) {
    setView({ kind: 'run', run });
    void kvSet(RUN_KV_KEY, run).catch(() => {});
    if (run.finished) {
      void queryClient.invalidateQueries({ queryKey: apiKey('declension.course') });
    }
  }

  function quit(run: TrainerRun) {
    if (run.results.length === 0) {
      void kvDelete(RUN_KV_KEY).catch(() => {});
      setView({ kind: 'setup', saved: null });
      return;
    }
    const batch = dueBatch(run.results, run.sentItems, true);
    void sendAttempts(batch.attempts);
    show({ ...run, sentItems: batch.sentItems, finished: true });
  }

  let body = null;
  if (view.kind === 'loading') body = <LoadingBlock />;
  else if (view.kind === 'setup')
    body = (
      <Setup
        saved={view.saved}
        onResume={() => view.saved && show(view.saved)}
        onDiscard={() => {
          // Answers already given still count: send what has not gone out yet.
          if (view.saved)
            void sendAttempts(dueBatch(view.saved.results, view.saved.sentItems, true).attempts);
          void kvDelete(RUN_KV_KEY).catch(() => {});
          setView({ kind: 'setup', saved: null });
        }}
        onStart={show}
      />
    );
  else if (view.run.finished)
    body = (
      <Summary
        run={view.run}
        onAgain={() => {
          void kvDelete(RUN_KV_KEY).catch(() => {});
          setView({ kind: 'setup', saved: null });
        }}
      />
    );
  else
    body =
      view.run.session.items.length === 0 ? (
        <EmptyState title={m.t('trainer.empty')} />
      ) : (
        <Running
          run={view.run}
          onItemDone={(r) => show(advance(view.run, r))}
          onQuit={() => quit(view.run)}
        />
      );

  return (
    <section className={cn('space-y-4 px-gutter py-6')}>
      <h1 className="text-2xl font-semibold text-fg">{t('screens.trainer')}</h1>
      {body}
    </section>
  );
}

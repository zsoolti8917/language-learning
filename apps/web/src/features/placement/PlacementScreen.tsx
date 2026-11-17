// The placement check of the first run (M5): an introduction, three vocabulary rounds with
// choices and "I don't know", one case round with typed answers and no feedback, a progress
// bar across the rounds and a result screen. A reload in the middle resumes the run.
import type { PlacementItem, PlacementResult, PlacementRound, ResponseOf } from '@app/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { api, apiQuery, isApiError } from '../../lib/api';
import { newId } from '../../lib/ids';
import { t } from '../../messages';
import { AnswerInput, Button, CASES, Card, CaseBadge, EmptyState, Skeleton } from '../../ui';
import { m } from './messages';
import {
  clearRun,
  type ItemAnswer,
  loadRun,
  markPlacementDone,
  progressOf,
  ROUND_COUNT,
  roundAnswers,
  type SavedRun,
  saveRun,
} from './run';

type Phase =
  | { kind: 'checking' }
  | { kind: 'intro' }
  | { kind: 'round'; run: SavedRun & { round: PlacementRound } }
  | { kind: 'result'; result: PlacementResult };

export function PlacementScreen() {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const showResult = async (result: PlacementResult, runId: string) => {
    await saveRun({ runId, index: 0, answers: {}, result });
    setPhase({ kind: 'result', result });
    await markPlacementDone(queryClient, result);
  };

  const showRound = async (runId: string, round: PlacementRound, keep?: SavedRun) => {
    const same = keep?.round?.round === round.round;
    const run = {
      runId,
      round,
      index: same ? Math.min(keep?.index ?? 0, round.items.length - 1) : 0,
      answers: same ? (keep?.answers ?? {}) : {},
    };
    await saveRun(run);
    setPhase({ kind: 'round', run });
    return run;
  };

  /** Brings a run in step with the server: GET /placement/:id. */
  const resync = async (saved: SavedRun) => {
    const run = await api.placement.get({ params: { id: saved.runId } });
    if (run.status === 'completed' && run.result) {
      await showResult(run.result, run.id);
      return null;
    }
    if (run.status === 'active' && run.round) return showRound(run.id, run.round, saved);
    await clearRun();
    setPhase({ kind: 'intro' });
    return null;
  };

  // Resume: a run kept on this device continues where it stopped.
  useEffect(() => {
    let live = true;
    void (async () => {
      const saved = await loadRun();
      if (!live) return;
      if (!saved) return setPhase({ kind: 'intro' });
      if (saved.result) {
        setPhase({ kind: 'result', result: saved.result });
        return;
      }
      try {
        const run = await resync(saved);
        // Closed while the last answers of a round were being sent: send them now.
        if (live && run?.round.items.every((i) => run.answers[i.itemId] !== undefined)) {
          await submit(run);
        }
      } catch (e) {
        if (!live) return;
        if (isApiError(e) && e.status === 404) {
          await clearRun();
          setPhase({ kind: 'intro' });
        } else if (saved.round) {
          // Offline: answer the kept round; sending waits for the connection.
          setPhase({ kind: 'round', run: { ...saved, round: saved.round } });
        } else {
          setError(e);
          setPhase({ kind: 'intro' });
        }
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const start = async () => {
    setBusy(true);
    setError(null);
    const runId = newId();
    // Kept before the call, so a reload during it finds the run on the server.
    await saveRun({ runId, index: 0, answers: {} });
    try {
      const run = await api.placement.start({ body: { id: runId } });
      if (run.round) await showRound(run.id, run.round);
      else if (run.result) await showResult(run.result, run.id);
    } catch (e) {
      await clearRun();
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const answer = (itemId: string, value: ItemAnswer) => {
    if (phase.kind !== 'round' || busy) return;
    const { run } = phase;
    const item = run.round.items[run.index];
    // A second tap on an item already answered (before the screen moved on) does nothing.
    if (!item || item.itemId !== itemId || run.answers[itemId] !== undefined) return;
    const answers = { ...run.answers, [item.itemId]: value };
    const last = run.index >= run.round.items.length - 1;
    const next = { ...run, answers, index: last ? run.index : run.index + 1 };
    // The screen moves on at once; the run is kept after every answer.
    setPhase({ kind: 'round', run: next });
    if (last) void saveRun(next).then(() => submit(next));
    else void saveRun(next);
  };

  const submit = async (run: SavedRun & { round: PlacementRound }) => {
    setBusy(true);
    setError(null);
    try {
      const res: ResponseOf<'placement.answer'> = await api.placement.answer({
        params: { id: run.runId },
        body: { round: run.round.round, answers: roundAnswers(run.round.items, run.answers) },
      });
      if (res.status === 'completed' && res.result) await showResult(res.result, run.runId);
      else if (res.round) await showRound(run.runId, res.round);
      else await resync(run);
    } catch (e) {
      // A refused round (answered already, say from another tab): take the server's state.
      if (isApiError(e) && !e.isNetwork && !e.isRetryable && e.status !== 401) {
        try {
          await resync(run);
          return;
        } catch {
          // Fall through to the error.
        }
      }
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="px-gutter py-6">
      <h1 className="text-2xl font-semibold text-fg">{t('screens.placement')}</h1>
      <div className="mt-4">
        {phase.kind === 'checking' && (
          <div role="status" aria-busy="true" aria-label={m.t('common.loading')}>
            <Skeleton lines={3} />
          </div>
        )}
        {phase.kind === 'intro' && <Intro busy={busy} error={error} onStart={() => void start()} />}
        {phase.kind === 'round' && (
          <RoundView
            run={phase.run}
            busy={busy}
            error={error}
            onAnswer={answer}
            onRetry={() => void submit(phase.run)}
          />
        )}
        {phase.kind === 'result' && <ResultView result={phase.result} />}
      </div>
    </section>
  );
}

function Intro({ busy, error, onStart }: { busy: boolean; error: unknown; onStart: () => void }) {
  return (
    <div className="space-y-4">
      <p className="text-lg text-fg">{m.t('intro.lead')}</p>
      <ul className="list-disc space-y-2 pl-5 text-base text-fg">
        <li>{m.t('intro.vocab')}</li>
        <li>{m.t('intro.cases')}</li>
        <li>{m.t('intro.noFeedback')}</li>
      </ul>
      <p className="text-base text-fg-muted">{m.t('intro.time')}</p>
      {error != null && (
        <p role="alert" className="text-base text-wrong">
          {isApiError(error) && error.isNetwork ? m.t('common.offline') : m.t('common.startError')}
        </p>
      )}
      <Button block size="lg" loading={busy} onClick={onStart}>
        {m.t('intro.start')}
      </Button>
    </div>
  );
}

function ProgressBar({ round, index, items }: { round: number; index: number; items: number }) {
  const share = progressOf(round, index, items);
  const percent = Math.round(share * 100);
  return (
    <div>
      <div className="flex justify-between text-sm text-fg-muted">
        <span>
          {m.t('progress.round', { round, rounds: ROUND_COUNT })} ·{' '}
          {round < ROUND_COUNT ? m.t('progress.vocab') : m.t('progress.cases')}
        </span>
        <span>{m.t('progress.item', { item: Math.min(index + 1, items), items })}</span>
      </div>
      <div
        role="progressbar"
        aria-label={m.t('progress.label')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={m.t('progress.value', {
          round,
          rounds: ROUND_COUNT,
          item: Math.min(index + 1, items),
          items,
        })}
        className="mt-2 flex h-2 gap-1"
      >
        {Array.from({ length: ROUND_COUNT }, (_, r) => {
          const fill = Math.min(1, Math.max(0, share * ROUND_COUNT - r));
          return (
            <span key={r} className="relative flex-1 overflow-hidden rounded-full bg-surface-2">
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${fill * 100}%` }}
              />
            </span>
          );
        })}
      </div>
    </div>
  );
}

function RoundView({
  run,
  busy,
  error,
  onAnswer,
  onRetry,
}: {
  run: SavedRun & { round: PlacementRound };
  busy: boolean;
  error: unknown;
  onAnswer: (itemId: string, a: ItemAnswer) => void;
  onRetry: () => void;
}) {
  const { round, index } = run;
  const item = round.items[index];
  const allAnswered = round.items.every((i) => run.answers[i.itemId] !== undefined);
  return (
    <div className="space-y-5">
      <ProgressBar
        round={round.round}
        index={allAnswered ? round.items.length : index}
        items={round.items.length}
      />
      {allAnswered ? (
        <SubmitState busy={busy} error={error} onRetry={onRetry} />
      ) : item?.kind === 'vocab' ? (
        <VocabItem key={item.itemId} item={item} onAnswer={onAnswer} />
      ) : item?.kind === 'case' ? (
        <CaseItem key={item.itemId} item={item} onAnswer={onAnswer} />
      ) : null}
    </div>
  );
}

function SubmitState({
  busy,
  error,
  onRetry,
}: {
  busy: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  if (busy || error == null) {
    return (
      <div role="status" aria-busy="true" className="space-y-3">
        <p className="text-base text-fg-muted">{m.t('submit.sending')}</p>
        <Skeleton lines={2} />
      </div>
    );
  }
  const offline = (isApiError(error) && error.isNetwork) || !navigator.onLine;
  return (
    <div role="alert">
      <EmptyState
        title={m.t('submit.error')}
        description={offline ? m.t('submit.offline') : undefined}
        action={<Button onClick={onRetry}>{m.t('submit.retry')}</Button>}
      />
    </div>
  );
}

type VocabItemData = Extract<PlacementItem, { kind: 'vocab' }>;
type CaseItemData = Extract<PlacementItem, { kind: 'case' }>;

function VocabItem({
  item,
  onAnswer,
}: {
  item: VocabItemData;
  onAnswer: (itemId: string, a: ItemAnswer) => void;
}) {
  const dontKnow = item.options.length - 1;
  return (
    <div>
      <p className="text-base text-fg-muted">{m.t('vocab.prompt')}</p>
      <p lang="sk" className="mt-2 text-4xl font-bold text-fg" data-testid="placement-lemma">
        {item.lemma}
      </p>
      <fieldset className="mt-5 flex flex-col gap-2">
        <legend className="sr-only">{m.t('vocab.options', { lemma: item.lemma })}</legend>
        {item.options.map((option, i) => (
          <Button
            key={i}
            block
            variant={i === dontKnow ? 'ghost' : 'secondary'}
            onClick={() => onAnswer(item.itemId, { choice: i })}
          >
            {option}
          </Button>
        ))}
      </fieldset>
    </div>
  );
}

function CaseItem({
  item,
  onAnswer,
}: {
  item: CaseItemData;
  onAnswer: (itemId: string, a: ItemAnswer) => void;
}) {
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  const { start, end } = item.blank;
  const ok = start >= 0 && end <= item.sentenceSk.length && start <= end;
  const before = ok ? item.sentenceSk.slice(0, start) : item.sentenceSk;
  const after = ok ? item.sentenceSk.slice(end) : '';
  const submit = (typed: string) => onAnswer(item.itemId, { typed: typed.trim() });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(value);
      }}
    >
      <p className="text-base text-fg-muted">{m.t('cases.prompt')}</p>
      <Card className="mt-2">
        <p lang="sk" className="text-reading text-fg" data-testid="placement-sentence">
          {before}
          <span className="mx-0.5 inline-block min-w-16 border-b-2 border-border-strong px-1 text-center font-semibold">
            {value.trim() || <span className="sr-only">{m.t('cases.gap')}</span>}
          </span>
          {after}
        </p>
        {item.sentenceEn && <p className="mt-1 text-sm text-fg-muted">{item.sentenceEn}</p>}
        <p className="mt-3 text-base text-fg">
          {m.t('cases.cue')}{' '}
          <span lang="sk" className="font-semibold">
            {item.cue}
          </span>
        </p>
      </Card>
      <div className="mt-4">
        <AnswerInput
          value={value}
          onValueChange={setValue}
          onSubmit={(typed) => {
            if (typed.trim() !== '') submit(typed);
          }}
          label={m.t('cases.answerLabel')}
          inputRef={input}
          name="typed"
        />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={() => submit('')}>
          {m.t('cases.dontKnow')}
        </Button>
        <Button type="submit" disabled={value.trim() === ''}>
          {m.t('cases.next')}
        </Button>
      </div>
    </form>
  );
}

const LESSON_ID = /^(nom|gen|dat|acc|voc|loc|ins)-(sg|pl)$/;

function ResultView({ result }: { result: PlacementResult }) {
  const navigate = useNavigate();
  const course = useQuery(apiQuery('declension.course'));
  const titleOf = (id: string) => course.data?.lessons.find((l) => l.id === id)?.titleEn;

  const lesson = (id: string) => {
    const title = titleOf(id);
    const match = LESSON_ID.exec(id);
    const c = match?.[1] as (typeof CASES)[number] | undefined;
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        {c && CASES.includes(c) && <CaseBadge case={c} variant="short" />}
        <span className="text-base text-fg">{title ?? id}</span>
      </span>
    );
  };

  return (
    <div className="space-y-5" data-testid="placement-result">
      <h2 className="text-xl font-semibold text-fg">{m.t('result.title')}</h2>
      <Card>
        <p className="text-lg text-fg">
          {result.knownUpToRank > 0
            ? m.t('result.known', { count: result.knownUpToRank })
            : m.t('result.knownNone')}
        </p>
        {result.knownUpToRank > 0 && (
          <p className="mt-1 text-sm text-fg-muted">{m.t('result.knownHint')}</p>
        )}
      </Card>
      <section aria-labelledby="placement-skipped">
        <h3 id="placement-skipped" className="text-lg font-semibold text-fg">
          {m.t('result.skipped')}
        </h3>
        {result.lessonsTestedOut.length === 0 ? (
          <p className="mt-1 text-base text-fg-muted">{m.t('result.skippedNone')}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {result.lessonsTestedOut.map((id) => (
              <li key={id} data-lesson={id}>
                {lesson(id)}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="placement-start">
        <h3 id="placement-start" className="text-lg font-semibold text-fg">
          {m.t('result.start')}
        </h3>
        <p className="mt-2" data-lesson-start={result.startLessonId}>
          {lesson(result.startLessonId)}
        </p>
      </section>
      <Button
        block
        size="lg"
        onClick={() => {
          void clearRun().then(() => navigate({ to: '/' }));
        }}
      >
        {m.t('result.continue')}
      </Button>
    </div>
  );
}

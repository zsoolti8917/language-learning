// The typed review session (M2): /review.
import type { Rating, ReviewItem } from '@app/contracts';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { useOutbox } from '../../lib/db';
import { useOnline } from '../../lib/pwa';
import { AnswerInput, type AnswerState, Button, Card, EmptyState, Skeleton } from '../../ui';
import { Feedback } from './Feedback';
import { feedbackFor } from './feedback';
import { m } from './messages';
import { ReportSheet } from './ReportSheet';
import { remaining } from './session';
import { defaultDeps, type ReviewDeps } from './store';
import { useReviewSession } from './useReviewSession';

const RATINGS: readonly Rating[] = [1, 2, 3, 4];

export function ratingLabel(r: Rating): string {
  return m.messages.rating[`r${r}`];
}

/** The sentence with its gap, or with the solution once the answer is graded. */
function Prompt({ item, solved }: { item: ReviewItem; solved: string | null }) {
  const { sentenceSk, blank } = item.prompt;
  return (
    <p lang="sk" className="text-reading leading-relaxed text-fg" data-testid="prompt">
      {sentenceSk.slice(0, blank.start)}
      {solved === null ? (
        <span
          role="img"
          aria-label={m.messages.review.gap}
          className="inline-block min-w-16 border-b-2 border-border-strong align-baseline"
        >
          &nbsp;
        </span>
      ) : (
        <span className="rounded-control bg-primary-soft px-1 font-semibold">{solved}</span>
      )}
      {sentenceSk.slice(blank.end)}
    </p>
  );
}

function ReviewHeader({ left }: { left: number | null }) {
  return (
    <header className="flex items-baseline justify-between gap-3">
      <h1 className="text-2xl font-semibold text-fg">{m.messages.review.title}</h1>
      <div className="flex items-baseline gap-3 text-sm text-fg-muted">
        {left !== null && <span data-testid="left">{m.t('review.left', { count: left })}</span>}
        <Link
          to="/deck"
          className="inline-flex min-h-tap items-center font-medium text-primary underline"
        >
          {m.messages.review.deckLink}
        </Link>
      </div>
    </header>
  );
}

function SyncLine({ outbox }: { outbox: ReviewDeps['outbox'] }) {
  const online = useOnline();
  const { pending } = useOutbox(outbox);
  if (online && pending === 0) return null;
  return (
    <p className="text-sm text-fg-muted" role="status" data-testid="sync-line">
      {!online && m.messages.review.offline}
      {!online && pending > 0 && ' '}
      {pending > 0 && m.messages.review.pending}
    </p>
  );
}

export function ReviewSession({
  deps = defaultDeps,
  now = Date.now,
}: {
  deps?: ReviewDeps;
  now?: () => number;
}) {
  const { session, load, reload, type, submit, reveal, rate } = useReviewSession(deps, now);
  const inputRef = useRef<HTMLInputElement>(null);
  const item = session.current;
  const status = session.status;

  // Keep the field focused between cards and after grading, so Enter always works.
  useEffect(() => {
    if (item && (status === 'answering' || status === 'feedback')) inputRef.current?.focus();
  }, [item, status]);

  let body: React.ReactNode;
  if (load.status === 'loading') {
    body = (
      <div
        className="space-y-3"
        aria-busy="true"
        aria-label={m.messages.review.loading}
        role="status"
      >
        <Skeleton className="h-32" />
        <Skeleton className="h-14" />
      </div>
    );
  } else if (load.status === 'error') {
    body =
      load.reason === 'offline' ? (
        <EmptyState
          title={m.messages.review.offlineTitle}
          description={m.messages.review.offlineText}
        />
      ) : (
        <EmptyState
          title={m.messages.review.errorTitle}
          description={m.messages.review.errorText}
          action={<Button onClick={() => void reload()}>{m.messages.review.retry}</Button>}
        />
      );
  } else if (status === 'done' && session.answered === 0) {
    body = (
      <EmptyState title={m.messages.review.emptyTitle} description={m.messages.review.emptyText} />
    );
  } else if (status === 'done') {
    body = (
      <EmptyState
        title={m.messages.review.doneTitle}
        description={m.t('review.doneText', { count: session.answered, correct: session.correct })}
        action={
          <Button variant="secondary" onClick={() => void reload()}>
            {m.messages.review.again}
          </Button>
        }
      />
    );
  } else if (item) {
    const outcome = session.outcome;
    const model = outcome ? feedbackFor(item, session.typed, outcome.grade) : null;
    const answerState: AnswerState = outcome
      ? outcome.grade === 'revealed'
        ? 'wrong'
        : outcome.grade
      : 'idle';
    body = (
      <div className="space-y-4" data-card={item.cardId}>
        <Card>
          <div className="space-y-2">
            <Prompt item={item} solved={model ? model.answer : null} />
            {item.prompt.cue && (
              <p className="text-base text-fg">
                <span className="text-fg-muted">{m.messages.review.cue}: </span>
                <span lang="sk" className="font-semibold">
                  {item.prompt.cue}
                </span>
              </p>
            )}
            {item.prompt.glossEn && (
              <p className="text-base text-fg">
                <span className="text-fg-muted">{m.messages.review.gloss}: </span>
                {item.prompt.glossEn}
              </p>
            )}
            <p className="text-base text-fg-muted">
              <span className="sr-only">{m.messages.review.english}: </span>
              {item.prompt.sentenceEn}
            </p>
          </div>
          <div className="mt-2 flex justify-end">
            <ReportSheet card={item} outbox={deps.outbox} />
          </div>
        </Card>
        <AnswerInput
          key={`${item.cardId}-${session.answered}`}
          inputRef={inputRef}
          label={m.messages.review.answerLabel}
          value={session.typed}
          onValueChange={type}
          readOnly={status === 'feedback'}
          state={answerState}
          stateLabels={{
            correct: m.messages.states.correct,
            close: m.messages.states.close,
            wrong:
              outcome?.grade === 'revealed' ? m.messages.states.revealed : m.messages.states.wrong,
          }}
          feedback={model ? <Feedback model={model} typed={session.typed} /> : undefined}
          onSubmit={() => (status === 'answering' ? submit() : rate())}
        />
        {status === 'answering' ? (
          <div className="flex gap-2">
            <Button variant="secondary" block onClick={reveal}>
              {m.messages.review.show}
            </Button>
            <Button block onClick={submit} disabled={session.typed.trim() === ''}>
              {m.messages.review.check}
            </Button>
          </div>
        ) : (
          outcome && (
            <div className="space-y-2">
              {/* biome-ignore lint/a11y/useSemanticElements: a labelled group of buttons, not a form fieldset */}
              <div
                role="group"
                aria-label={m.messages.rating.label}
                className="grid grid-cols-4 gap-2"
              >
                {RATINGS.map((r) => (
                  <Button
                    key={r}
                    variant={r === outcome.defaultRating ? 'primary' : 'secondary'}
                    data-default={r === outcome.defaultRating ? '' : undefined}
                    className="px-1"
                    onClick={() => rate(r)}
                  >
                    {ratingLabel(r)}
                  </Button>
                ))}
              </div>
              <p className="text-center text-sm text-fg-muted">
                {m.t('rating.hint', { rating: ratingLabel(outcome.defaultRating) })}
              </p>
            </div>
          )
        )}
      </div>
    );
  }

  return (
    <section className="space-y-4 px-gutter py-6">
      <ReviewHeader left={load.status === 'ready' && item ? remaining(session) : null} />
      <SyncLine outbox={deps.outbox} />
      {body}
    </section>
  );
}

export function ReviewScreen() {
  return <ReviewSession />;
}

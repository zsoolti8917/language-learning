// One exercise item: the sentence with its gap, a typed answer or a choice, the diagnosis and
// its feedback. A wrong answer gets one retry (when allowed); the retry counts as `retry`.
import type { AttemptInput, ExerciseItem } from '@app/contracts';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { AnswerInput, type AnswerState, Button, cn } from '../../ui';
import { type ItemResult, makeAttempt } from './attempts';
import { type Graded, grade } from './feedback';
import { patternModel } from './grammar';
import { m } from './messages';
import { RichText } from './RichText';

export interface ExerciseViewProps {
  item: ExerciseItem;
  source: 'trainer' | 'lesson';
  sessionId?: string | undefined;
  /** One retry after a wrong answer (default true). */
  allowRetry?: boolean;
  /** Shows the cue and the trigger as a hint (production step). */
  showTrigger?: boolean;
  /** The label of the button that moves on. */
  nextLabel?: string;
  /** Called with every attempt as soon as it is made. */
  onAttempt?: (attempt: AttemptInput) => void;
  /** Called when the learner moves on. */
  onDone: (result: ItemResult & { graded: Graded }) => void;
}

type Phase = 'answer' | 'retry' | 'done';

function Sentence({ item, filled }: { item: ExerciseItem; filled: string | null }) {
  const { sentenceSk: s, blank } = item;
  const before = s.slice(0, blank.start);
  const target = s.slice(blank.start, blank.end);
  const after = s.slice(blank.end);
  if (item.kind === 'choice_meaning') {
    return (
      <p lang="sk" className="text-reading leading-relaxed text-fg">
        {before}
        <mark className="rounded bg-primary-soft px-1 font-semibold text-fg">{target}</mark>
        {after}
      </p>
    );
  }
  return (
    <p lang="sk" className="text-reading leading-relaxed text-fg" data-testid="sentence">
      {before}
      {filled ? (
        <mark className="rounded bg-primary-soft px-1 font-semibold text-fg">{filled}</mark>
      ) : (
        <span
          role="img"
          aria-label={m.t('item.gap')}
          className="inline-block min-w-16 border-b-2 border-border-strong align-baseline"
        >
          &nbsp;
        </span>
      )}
      {after}
    </p>
  );
}

const STATE_LABELS = () => ({
  correct: m.t('item.stateCorrect'),
  close: m.t('item.stateClose'),
  wrong: m.t('item.stateWrong'),
});

export function ExerciseView({
  item,
  source,
  sessionId,
  allowRetry = true,
  showTrigger = false,
  nextLabel,
  onAttempt,
  onDone,
}: ExerciseViewProps) {
  const [phase, setPhase] = useState<Phase>('answer');
  const [typed, setTyped] = useState('');
  const [graded, setGraded] = useState<Graded | null>(null);
  const [wrongPicks, setWrongPicks] = useState<string[]>([]);
  const attempts = useRef<AttemptInput[]>([]);
  const shownAt = useRef(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const isChoice = item.kind !== 'cloze';

  useEffect(() => {
    if (!isChoice) inputRef.current?.focus();
  }, [isChoice]);

  useEffect(() => {
    if (phase === 'done') nextRef.current?.focus();
  }, [phase]);

  function submit(value: string) {
    if (phase === 'done' || value.trim() === '') return;
    const g = grade(item, value);
    const retry = phase === 'retry';
    const attempt = makeAttempt({
      exerciseId: item.exerciseId,
      source,
      sessionId,
      typed: value.trim(),
      correct: g.correct,
      retry,
      diagnosis: g.diagnosis,
      durationMs: Date.now() - shownAt.current,
    });
    attempts.current.push(attempt);
    onAttempt?.(attempt);
    setGraded(g);
    if (!g.correct && isChoice) setWrongPicks((w) => [...w, value]);
    if (!g.correct && !retry && allowRetry) {
      shownAt.current = Date.now();
      setPhase('retry');
      return;
    }
    setPhase('done');
  }

  function next() {
    if (phase !== 'done' || !graded) return;
    onDone({ exerciseId: item.exerciseId, attempts: attempts.current, graded });
  }

  const state: AnswerState = graded ? graded.state : 'idle';
  const fragments = graded ? (phase === 'retry' ? graded.hint : graded.feedback) : null;
  const finalCorrect = phase === 'done' && graded?.correct;
  const filled =
    phase === 'done' && item.kind !== 'choice_meaning' ? (item.answers[0] ?? null) : null;
  const patternId = phase === 'done' ? graded?.patternId : undefined;

  const feedback = fragments ? (
    <>
      <RichText fragments={fragments} />
      {phase === 'retry' && <> {m.t('item.tryAgain')}</>}
    </>
  ) : undefined;

  const cueLine =
    showTrigger && item.trigger
      ? m.t('lesson.hintTrigger', { cue: item.cue, trigger: item.trigger.label })
      : m.t('lesson.hint', { cue: item.cue });

  return (
    <div className="space-y-4" data-exercise={item.exerciseId} data-phase={phase}>
      <div className="space-y-1">
        <Sentence item={item} filled={filled} />
        {item.kind !== 'choice_meaning' && (
          <p className="text-sm text-fg-muted" lang="sk">
            {cueLine}
          </p>
        )}
        {item.kind !== 'choice_meaning' && (
          <p className="text-sm text-fg-muted">{item.sentenceEn}</p>
        )}
      </div>

      {isChoice ? (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium text-fg">
            {item.kind === 'choice_meaning' ? m.t('item.chooseMeaning') : m.t('item.chooseForm')}
          </legend>
          {(item.options ?? []).map((o) => {
            const picked = wrongPicks.includes(o.text);
            const showRight = phase === 'done' && o.correct;
            return (
              <Button
                key={o.text}
                variant="secondary"
                block
                lang={item.kind === 'choice_meaning' ? 'en' : 'sk'}
                disabled={phase === 'done' || picked}
                aria-pressed={picked || showRight}
                className={cn(
                  'justify-between text-left',
                  picked && 'border-wrong bg-wrong-soft',
                  showRight && 'border-correct bg-correct-soft',
                )}
                onClick={() => submit(o.text)}
              >
                <span>{o.text}</span>
                {(picked || showRight) && <span aria-hidden="true">{showRight ? '✓' : '✕'}</span>}
              </Button>
            );
          })}
          <div role="status" aria-live="polite" className="min-h-6 text-base">
            {graded && (
              <span
                className={cn(
                  'font-semibold',
                  state === 'correct'
                    ? 'text-correct'
                    : state === 'close'
                      ? 'text-close'
                      : 'text-wrong',
                )}
              >
                {STATE_LABELS()[state as 'correct']}
              </span>
            )}
            {feedback && <span className="text-fg"> · {feedback}</span>}
          </div>
        </fieldset>
      ) : (
        <AnswerInput
          value={typed}
          onValueChange={setTyped}
          onSubmit={(v) => (phase === 'done' ? next() : submit(v))}
          label={m.t('item.gapLabel')}
          state={phase === 'retry' ? state : phase === 'done' ? state : 'idle'}
          feedback={feedback}
          stateLabels={STATE_LABELS()}
          accentBarLabel={m.t('item.accentBar')}
          readOnly={phase === 'done'}
          inputRef={inputRef}
        />
      )}

      {patternId && (
        <p className="text-sm">
          <Link
            to="/cases/pattern/$patternId"
            params={{ patternId }}
            className="inline-flex min-h-tap items-center font-medium text-primary underline"
          >
            {m.t('item.patternLink', { pattern: patternModel(patternId) ?? patternId })}
          </Link>
        </p>
      )}

      <div className="flex gap-3">
        {phase === 'done' ? (
          <Button ref={nextRef} block onClick={next} data-correct={finalCorrect ? 'true' : 'false'}>
            {nextLabel ?? m.t('item.next')}
          </Button>
        ) : (
          !isChoice && (
            <Button block onClick={() => submit(typed)} disabled={typed.trim() === ''}>
              {m.t('item.check')}
            </Button>
          )
        )}
      </div>
    </div>
  );
}

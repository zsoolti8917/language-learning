// The lesson player: five steps (meaning, triggers, comprehension, production, checkpoint),
// progress saved after each step, and a completion screen with the cards that were added.
import type {
  Case,
  LessonDetail,
  LessonProgress,
  LessonScore,
  LessonStep,
  NoteSummary,
  Trigger,
} from '@app/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { type ReactNode, useRef, useState } from 'react';
import { apiKey, apiQuery } from '../../lib/api';
import { t } from '../../messages';
import {
  Button,
  buttonClasses,
  CASE_CLASSES,
  Card,
  CaseBadge,
  cn,
  EmptyState,
  ProgressRing,
} from '../../ui';
import { type ItemResult, sendAttempts } from './attempts';
import { ExerciseView } from './ExerciseView';
import { m } from './messages';
import { saveProgress } from './progress';
import { QueryState } from './QueryState';
import { Markdown } from './RichText';

const DEFAULT_PASS_SHARE = 0.75;

function Highlighted({
  sk,
  highlight,
  c,
}: {
  sk: string;
  highlight: { start: number; end: number };
  c: Case | null;
}) {
  return (
    <span lang="sk">
      {sk.slice(0, highlight.start)}
      <mark
        className={cn(
          'rounded px-1 font-semibold text-fg',
          c ? CASE_CLASSES[c].soft : 'bg-primary-soft',
        )}
      >
        {sk.slice(highlight.start, highlight.end)}
      </mark>
      {sk.slice(highlight.end)}
    </span>
  );
}

function ExplainStep({
  step,
  lessonCase,
  onNext,
}: {
  step: Extract<LessonStep['content'], { kind: 'explain' }>;
  lessonCase: Case | null;
  onNext: () => void;
}) {
  return (
    <div className="space-y-4">
      {lessonCase && <CaseBadge case={lessonCase} label={m.t(`caseTitle.${lessonCase}`)} />}
      <Markdown md={step.md} />
      {step.examples.length > 0 && (
        <Card title={m.t('lesson.examples')}>
          <ul className="space-y-3">
            {step.examples.map((e) => (
              <li key={e.sk}>
                <p className="text-reading">
                  <Highlighted sk={e.sk} highlight={e.highlight} c={lessonCase} />
                </p>
                <p className="text-sm text-fg-muted">{e.en}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Button block onClick={onNext}>
        {m.t('lesson.continue')}
      </Button>
    </div>
  );
}

function TriggerCard({ trigger }: { trigger: Trigger }) {
  return (
    <li>
      <Card compact data-trigger={trigger.id}>
        <div className="flex items-start justify-between gap-3">
          <p className="text-xl font-semibold" lang="sk">
            {trigger.lemma}
          </p>
          <CaseBadge case={trigger.case} label={m.t(`caseTitle.${trigger.case}`)} />
        </div>
        <p className="text-base text-fg">{trigger.meaningEn}</p>
        {trigger.noteEn && <p className="mt-1 text-sm text-fg-muted">{trigger.noteEn}</p>}
        {trigger.exampleSk && (
          <p className="mt-2 text-base">
            <span className="sr-only">{m.t('lesson.example')}: </span>
            <span lang="sk" className="italic">
              {trigger.exampleSk}
            </span>
            <span className="block text-sm text-fg-muted">{trigger.exampleEn}</span>
          </p>
        )}
      </Card>
    </li>
  );
}

function TriggersStep({
  ids,
  triggers,
  lessonCase,
  onNext,
}: {
  ids: string[];
  triggers: Trigger[];
  lessonCase: Case | null;
  onNext: () => void;
}) {
  const shown = ids
    .map((id) => triggers.find((tr) => tr.id === id))
    .filter((tr): tr is Trigger => tr !== undefined);
  return (
    <div className="space-y-4">
      <p className="text-base text-fg">
        {lessonCase
          ? m.t('lesson.triggersIntro', { case: m.t(`caseName.${lessonCase}`) })
          : m.t('lesson.triggersIntroNoCase')}
      </p>
      <ul className="space-y-2">
        {shown.map((tr) => (
          <TriggerCard key={tr.id} trigger={tr} />
        ))}
      </ul>
      <Button block onClick={onNext}>
        {m.t('lesson.continue')}
      </Button>
    </div>
  );
}

function scoreOf(results: ItemResult[]): LessonScore {
  return {
    correct: results.filter((r) => r.attempts[0]?.correct).length,
    total: results.length,
  };
}

function ExercisesStep({
  step,
  onDone,
}: {
  step: LessonStep;
  onDone: (results: ItemResult[]) => void;
}) {
  const [index, setIndex] = useState(0);
  const results = useRef<ItemResult[]>([]);
  const kind = step.content.kind;
  const items = step.exercises;
  if (items.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyState title={m.t('lesson.noItems')} />
        <Button block onClick={() => onDone([])}>
          {m.t('lesson.continue')}
        </Button>
      </div>
    );
  }
  const item = items[index];
  if (!item) return null;
  const last = index === items.length - 1;
  return (
    <div className="space-y-3">
      <p className="text-sm text-fg-muted" aria-live="polite">
        {m.t('lesson.itemOf', { current: index + 1, total: items.length })}
      </p>
      <ExerciseView
        key={`${item.exerciseId}-${index}`}
        item={item}
        source="lesson"
        allowRetry={kind !== 'checkpoint'}
        showTrigger={kind === 'production'}
        nextLabel={last ? m.t('lesson.continue') : m.t('item.next')}
        onDone={(r) => {
          results.current.push({ exerciseId: r.exerciseId, attempts: r.attempts });
          if (last) onDone(results.current);
          else setIndex(index + 1);
        }}
      />
    </div>
  );
}

function CheckpointResult({
  score,
  passShare,
  onRetry,
}: {
  score: LessonScore;
  passShare: number;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-4 text-center" data-testid="checkpoint-failed">
      <h2 className="text-xl font-semibold text-fg">{m.t('lesson.failed')}</h2>
      <div className="flex justify-center">
        <ProgressRing
          value={score.correct}
          max={Math.max(1, score.total)}
          label={m.t('lesson.checkpointScore', score)}
          valueText={m.t('course.score', score)}
        >
          {m.t('course.score', score)}
        </ProgressRing>
      </div>
      <p className="text-base text-fg">{m.t('lesson.checkpointScore', score)}</p>
      <p className="text-base text-fg-muted">
        {m.t('lesson.checkpointNeed', { percent: Math.round(passShare * 100) })}
      </p>
      <Button block onClick={onRetry}>
        {m.t('lesson.retryCheckpoint')}
      </Button>
    </div>
  );
}

/** The case sentence cards the completion created (notes from this lesson, made at completion). */
function useAddedCards(progress: LessonProgress | null) {
  return useQuery({
    ...apiQuery('notes.list', { query: { kind: 'case_sentence', limit: 50 } }),
    enabled: progress?.completedAt != null,
    select: (page): NoteSummary[] => {
      const since = Date.parse(progress?.completedAt ?? '') - 60_000;
      return page.items.filter(
        (n) => n.source === 'declension' && Date.parse(n.createdAt) >= since,
      );
    },
  });
}

function Complete({ score, progress }: { score: LessonScore; progress: LessonProgress | null }) {
  const cards = useAddedCards(progress);
  return (
    <div className="space-y-5" data-testid="lesson-complete">
      <div className="space-y-3 text-center">
        <h2 className="text-xl font-semibold text-fg">{m.t('lesson.completeTitle')}</h2>
        <div className="flex justify-center">
          <ProgressRing
            value={score.correct}
            max={Math.max(1, score.total)}
            label={m.t('lesson.checkpointScore', score)}
            valueText={m.t('course.score', score)}
          >
            {m.t('course.score', score)}
          </ProgressRing>
        </div>
        <p className="text-base text-fg">{m.t('lesson.checkpointScore', score)}</p>
      </div>
      <Card title={m.t('lesson.cardsAdded')}>
        {cards.data && cards.data.length > 0 ? (
          <ul className="space-y-2" data-testid="added-cards">
            {cards.data.map((n) => (
              <li key={n.id}>
                <Link
                  to="/deck/$noteId"
                  params={{ noteId: n.id }}
                  lang="sk"
                  className="inline-flex min-h-tap items-center font-medium text-primary underline"
                >
                  {n.label}
                </Link>
                {n.glossEn && <span className="ml-2 text-sm text-fg-muted">{n.glossEn}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-base text-fg-muted">{m.t('lesson.cardsNone')}</p>
        )}
      </Card>
      <div className="space-y-2">
        <Link to="/cases" className={buttonClasses({ block: true })}>
          {m.t('lesson.backToCourse')}
        </Link>
        <Link to="/cases/train" className={buttonClasses({ block: true, variant: 'secondary' })}>
          {m.t('lesson.train')}
        </Link>
      </div>
    </div>
  );
}

export function LessonPlayer({ detail }: { detail: LessonDetail }) {
  const { lesson, steps, triggers, progress } = detail;
  const queryClient = useQueryClient();
  const lastIndex = Math.max(0, steps.length - 1);
  const [stepIndex, setStepIndex] = useState(() =>
    progress?.status === 'in_progress' ? Math.min(progress.stepIndex, lastIndex) : 0,
  );
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState<LessonScore | null>(null);
  const [done, setDone] = useState<{ score: LessonScore; progress: LessonProgress | null } | null>(
    null,
  );
  const step = steps[stepIndex];

  async function next() {
    const nextIndex = stepIndex + 1;
    setStepIndex(Math.min(nextIndex, lastIndex));
    window.scrollTo?.(0, 0);
    await saveProgress(lesson.id, {
      stepIndex: Math.min(nextIndex, lastIndex),
      status: 'in_progress',
    });
  }

  async function finishExercises(results: ItemResult[]) {
    void sendAttempts(results.flatMap((r) => r.attempts));
    if (step?.content.kind !== 'checkpoint') {
      if (stepIndex < lastIndex) await next();
      return;
    }
    const score = scoreOf(results);
    const passShare = step.content.passShare ?? DEFAULT_PASS_SHARE;
    if (score.total > 0 && score.correct / score.total < passShare) {
      setFailed(score);
      return;
    }
    const saved = await saveProgress(lesson.id, {
      stepIndex: stepIndex,
      status: 'completed',
      score,
    });
    setDone({ score, progress: saved });
    void queryClient.invalidateQueries({ queryKey: apiKey('declension.course') });
    void queryClient.invalidateQueries({ queryKey: ['api', 'declension.lesson'] });
  }

  let body: ReactNode = null;
  if (done) body = <Complete score={done.score} progress={done.progress} />;
  else if (failed && step?.content.kind === 'checkpoint')
    body = (
      <CheckpointResult
        score={failed}
        passShare={step.content.passShare ?? DEFAULT_PASS_SHARE}
        onRetry={() => {
          setFailed(null);
          setAttempt((a) => a + 1);
        }}
      />
    );
  else if (step) {
    const c = step.content;
    body =
      c.kind === 'explain' ? (
        <ExplainStep step={c} lessonCase={lesson.case} onNext={() => void next()} />
      ) : c.kind === 'triggers' ? (
        <TriggersStep
          ids={c.triggerIds}
          triggers={triggers}
          lessonCase={lesson.case}
          onNext={() => void next()}
        />
      ) : (
        <ExercisesStep
          key={`${stepIndex}-${attempt}`}
          step={step}
          onDone={(r) => void finishExercises(r)}
        />
      );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-fg">{lesson.titleEn}</h2>
        <p className="text-sm text-fg-muted" lang="sk">
          {lesson.titleSk}
        </p>
      </div>
      {!done && step && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-fg" data-testid="step-label">
            {m.t('lesson.stepOf', { current: stepIndex + 1, total: steps.length })} ·{' '}
            {m.t(`stepKind.${step.content.kind}`)}
          </p>
          <ol className="flex gap-1" aria-hidden="true">
            {steps.map((s, i) => (
              <li
                key={s.ord}
                className={`h-2 w-6 rounded-full ${i <= stepIndex ? 'bg-primary' : 'bg-surface-2'}`}
              />
            ))}
          </ol>
        </div>
      )}
      {body}
    </div>
  );
}

export function LessonScreen() {
  const { lessonId } = useParams({ strict: false });
  const id = String(lessonId);
  const query = useQuery(apiQuery('declension.lesson', { params: { id } }));
  return (
    <section className="space-y-4 px-gutter py-6">
      <h1 className="text-2xl font-semibold text-fg">{t('screens.lesson')}</h1>
      <QueryState query={query} notFound={m.t('lesson.notFound')}>
        {(detail) => <LessonPlayer key={detail.lesson.id} detail={detail} />}
      </QueryState>
    </section>
  );
}

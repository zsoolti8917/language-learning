// The end screen: what went well, the mistakes by type, the corrections and the new cards.
import type { ErrorType, ScenarioBrief, TutorErrorStatus, TutorSummary } from '@app/contracts';
import { Link } from '@tanstack/react-router';
import { Button, Card } from '../../ui';
import { GoalCriteria } from './Goal';
import { m } from './messages';

const STATUS_LABEL: Record<TutorErrorStatus, string> = {
  prompted: m.messages.summary.statusPrompted,
  self_corrected: m.messages.summary.statusSelfCorrected,
  corrected: m.messages.summary.statusCorrected,
  summary_only: m.messages.summary.statusSummaryOnly,
  disputed: m.messages.summary.statusDisputed,
};

/** Counts per error type, most frequent first, in a stable order. */
export function errorsByType(errors: TutorSummary['errors']): [ErrorType, number][] {
  const counts = new Map<ErrorType, number>();
  for (const e of errors) counts.set(e.errorType, (counts.get(e.errorType) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function cardsText(count: number): string {
  if (count === 0) return m.t('summary.cardsNone');
  if (count === 1) return m.t('summary.cardsOne');
  return m.t('summary.cardsMany', { count });
}

export function Summary({
  summary,
  cardsCreated,
  scenario,
}: {
  summary: TutorSummary;
  cardsCreated: number;
  scenario: ScenarioBrief;
}) {
  const byType = errorsByType(summary.errors);
  const corrections = summary.errors.filter((e) => e.expected !== undefined);
  return (
    <section
      aria-labelledby="tutor-summary"
      className="flex flex-col gap-4 px-gutter py-4"
      data-summary=""
    >
      <h2 id="tutor-summary" className="text-xl font-semibold text-fg">
        {m.t('summary.title')}
      </h2>
      <p className="whitespace-pre-wrap text-base text-fg">{summary.textEn}</p>

      <Card compact>
        <p className="font-semibold text-fg">
          <span
            aria-hidden="true"
            className={summary.goalMet ? 'mr-1 text-correct' : 'mr-1 text-fg-muted'}
          >
            {summary.goalMet ? '✓' : '○'}
          </span>
          {summary.goalMet ? m.t('summary.goalMet') : m.t('summary.goalNotMet')}
        </p>
        <GoalCriteria
          criteria={scenario.successCriteria}
          met={summary.criteriaMet}
          label={m.t('summary.criteria')}
        />
      </Card>

      <Card compact>
        <h3 className="text-lg font-semibold">{m.t('summary.byType')}</h3>
        {byType.length === 0 ? (
          <p className="mt-1 text-base text-fg-muted">{m.t('summary.noErrors')}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1" aria-label={m.t('summary.byType')}>
            {byType.map(([type, count]) => (
              <li
                key={type}
                data-error-type={type}
                className="flex justify-between gap-3 text-base"
              >
                <span>{m.messages.errorTypes[type]}</span>
                <span className="font-semibold tabular-nums">{count}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {corrections.length > 0 && (
        <Card compact>
          <h3 className="text-lg font-semibold">{m.t('summary.corrections')}</h3>
          <ul className="mt-2 flex flex-col gap-3" aria-label={m.t('summary.corrections')}>
            {corrections.map((e) => (
              <li key={e.id} data-correction={e.status} className="flex flex-col gap-1 text-base">
                <p>
                  <span lang="sk" className="line-through decoration-wrong">
                    {e.given}
                  </span>
                  <span aria-hidden="true"> → </span>
                  <span lang="sk" className="font-semibold">
                    {e.expected}
                  </span>
                  <span className="text-fg-muted"> · {STATUS_LABEL[e.status]}</span>
                </p>
                {e.correctedSentence && (
                  <p lang="sk" className="whitespace-pre-wrap text-fg">
                    {e.correctedSentence}
                  </p>
                )}
                {e.explanationEn && (
                  <p className="whitespace-pre-wrap text-fg-muted">{e.explanationEn}</p>
                )}
                {!e.verified && (
                  <p className="text-sm text-fg-muted">{m.t('summary.unverified')}</p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card compact>
        <h3 className="text-lg font-semibold">{m.t('summary.cards')}</h3>
        <p className="mt-1 text-base" data-cards-created={cardsCreated}>
          {cardsText(cardsCreated)}
        </p>
      </Card>

      <div className="flex flex-col gap-2">
        <Button asChild block>
          <Link to="/review">{m.t('summary.toReview')}</Link>
        </Button>
        <Button asChild block variant="secondary">
          <Link to="/tutor">{m.t('summary.again')}</Link>
        </Button>
      </div>
    </section>
  );
}

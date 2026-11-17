// The scenario's goal with a tick for each criterion the learner has met.
import type { ScenarioBrief } from '@app/contracts';
import { Card, cn } from '../../ui';
import { m } from './messages';

export function GoalCriteria({
  criteria,
  met,
  label,
}: {
  criteria: ScenarioBrief['successCriteria'];
  met: readonly string[];
  label: string;
}) {
  return (
    <ul aria-label={label} className="mt-2 flex flex-col gap-1">
      {criteria.map((c) => {
        const done = met.includes(c.id);
        return (
          <li
            key={c.id}
            data-criterion={c.id}
            data-met={done}
            className="flex items-start gap-2 text-base"
          >
            <span
              aria-hidden="true"
              className={cn(
                'grid size-5 shrink-0 place-items-center rounded-full border text-xs font-bold',
                done
                  ? 'border-correct bg-correct text-primary-fg'
                  : 'border-border-strong text-transparent',
              )}
            >
              ✓
            </span>
            <span className={done ? 'text-fg' : 'text-fg-muted'}>
              {c.textEn}
              <span className="sr-only">
                {' '}
                ({done ? m.t('chat.criterionMet') : m.t('chat.criterionOpen')})
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function GoalPanel({ scenario, met }: { scenario: ScenarioBrief; met: readonly string[] }) {
  return (
    <Card compact className="mt-3">
      <p lang="sk" className="text-base text-fg-muted">
        {scenario.settingSk}
      </p>
      <p className="mt-1 text-base font-semibold text-fg">
        {m.t('chat.goalLabel')}: {scenario.goalEn}
      </p>
      <GoalCriteria criteria={scenario.successCriteria} met={met} label={m.t('chat.goalLabel')} />
      {scenario.vocabHint.length > 0 && (
        <p className="mt-2 text-sm text-fg-muted">
          {m.t('chat.vocabLabel')}:{' '}
          {scenario.vocabHint.map((v, i) => (
            <span key={v.sk}>
              {i > 0 && ', '}
              <span lang="sk" className="font-medium text-fg">
                {v.sk}
              </span>{' '}
              ({v.en})
            </span>
          ))}
        </p>
      )}
    </Card>
  );
}

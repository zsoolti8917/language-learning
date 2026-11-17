// The scenario picker (/tutor): scenarios with goal, level, cases and how often each was done,
// and the learner's conversations to continue.
import type { ConversationSummary, RunStatus, ScenarioSummary } from '@app/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { api, apiKey, apiQuery } from '../../lib/api';
import { newId } from '../../lib/ids';
import { useOnline } from '../../lib/pwa';
import { t } from '../../messages';
import { Button, Card, CaseBadge, EmptyState, Skeleton, useToast } from '../../ui';
import { m } from './messages';

const STATUS: Record<RunStatus, string> = {
  active: m.messages.scenarios.statusActive,
  completed: m.messages.scenarios.statusCompleted,
  abandoned: m.messages.scenarios.statusAbandoned,
};

function timesDone(count: number): string {
  if (count === 0) return m.t('scenarios.timesDone');
  if (count === 1) return m.t('scenarios.timesDoneOne');
  return m.t('scenarios.timesDoneMany', { count });
}

function ScenarioCard({
  scenario,
  starting,
  disabled,
  onStart,
}: {
  scenario: ScenarioSummary;
  starting: boolean;
  disabled: boolean;
  onStart: () => void;
}) {
  return (
    <li>
      <Card compact data-scenario={scenario.id}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-fg">{scenario.titleEn}</h3>
            <p lang="sk" className="text-base text-fg-muted">
              {scenario.titleSk}
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-border-strong px-2 py-0.5 text-sm font-semibold">
            {m.t('scenarios.level', { level: scenario.level })}
          </span>
        </div>
        <p className="mt-2 text-base text-fg">{m.t('scenarios.goal', { goal: scenario.goalEn })}</p>
        {scenario.targetCases.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="sr-only">{m.t('scenarios.targetCases')}:</span>
            {scenario.targetCases.map((c) => (
              <CaseBadge key={c} case={c} />
            ))}
          </div>
        )}
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-sm text-fg-muted">
            {scenario.mode === 'case_coach' && `${m.t('scenarios.coach')} · `}
            {timesDone(scenario.timesDone)}
          </p>
          <Button loading={starting} disabled={disabled} onClick={onStart}>
            {m.t('scenarios.start')}
          </Button>
        </div>
      </Card>
    </li>
  );
}

function ConversationRow({ c }: { c: ConversationSummary }) {
  return (
    <li>
      <Card asChild compact>
        <Link
          to="/tutor/$conversationId"
          params={{ conversationId: c.id }}
          data-conversation={c.id}
        >
          <span className="flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block truncate font-semibold text-fg">{c.titleEn}</span>
              <span className="block text-sm text-fg-muted">
                {STATUS[c.status]} · {m.t('scenarios.turns', { count: c.turnCount })}
              </span>
            </span>
            <span className="shrink-0 font-semibold text-primary">
              {c.status === 'active' ? m.t('scenarios.resume') : m.t('scenarios.open')}
            </span>
          </span>
        </Link>
      </Card>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div
      className="flex flex-col gap-3"
      aria-busy="true"
      role="status"
      aria-label={t('app.loading')}
    >
      <Skeleton height="8rem" />
      <Skeleton height="8rem" />
    </div>
  );
}

export function ScenariosScreen() {
  const online = useOnline();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const scenarios = useQuery(apiQuery('tutor.scenarios'));
  const conversations = useQuery(apiQuery('tutor.listConversations', { query: { limit: 20 } }));
  const [starting, setStarting] = useState<string | null>(null);

  const start = async (scenarioId: string) => {
    setStarting(scenarioId);
    try {
      const detail = await api.tutor.startConversation({ body: { id: newId(), scenarioId } });
      const id = detail.conversation.id;
      queryClient.setQueryData(apiKey('tutor.getConversation', { params: { id } }), detail);
      void queryClient.invalidateQueries({ queryKey: ['api', 'tutor.listConversations'] });
      await navigate({ to: '/tutor/$conversationId', params: { conversationId: id } });
    } catch {
      toast({ title: m.t('scenarios.startFailed'), tone: 'error' });
    } finally {
      setStarting(null);
    }
  };

  const recent = conversations.data?.items ?? [];

  return (
    <section className="flex flex-col gap-4 px-gutter py-6">
      <header>
        <h1 className="text-2xl font-semibold text-fg">{t('screens.scenarios')}</h1>
        <p className="mt-1 text-base text-fg-muted">{m.t('scenarios.intro')}</p>
      </header>

      {!online && !scenarios.data && (
        <EmptyState title={m.t('offline.title')} description={m.t('offline.description')} />
      )}

      {recent.length > 0 && (
        <section aria-labelledby="tutor-recent" className="flex flex-col gap-2">
          <h2 id="tutor-recent" className="text-lg font-semibold">
            {m.t('scenarios.resumeTitle')}
          </h2>
          <ul className="flex flex-col gap-2">
            {recent.map((c) => (
              <ConversationRow key={c.id} c={c} />
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="tutor-scenarios" className="flex flex-col gap-2">
        <h2 id="tutor-scenarios" className="text-lg font-semibold">
          {m.t('scenarios.listLabel')}
        </h2>
        {scenarios.isPending && online && <ListSkeleton />}
        {scenarios.isError && online && (
          <div role="alert">
            <EmptyState
              title={m.t('scenarios.loadFailed')}
              action={<Button onClick={() => scenarios.refetch()}>{t('app.retry')}</Button>}
            />
          </div>
        )}
        {scenarios.data && scenarios.data.items.length === 0 && (
          <EmptyState title={m.t('scenarios.empty')} description={m.t('scenarios.emptyHint')} />
        )}
        {scenarios.data && scenarios.data.items.length > 0 && (
          <ul className="flex flex-col gap-3">
            {scenarios.data.items.map((s) => (
              <ScenarioCard
                key={s.id}
                scenario={s}
                starting={starting === s.id}
                disabled={!online || (starting !== null && starting !== s.id)}
                onStart={() => void start(s.id)}
              />
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

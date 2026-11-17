// The tutor chat (/tutor/$conversationId): messages with error marks, the live reply, peeks,
// disputes, goal ticks, and the end summary.
import { Link, useParams } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { isApiError } from '../../lib/api';
import { useOnline } from '../../lib/pwa';
import { t } from '../../messages';
import { Button, EmptyState, Skeleton, useToast } from '../../ui';
import { Composer } from './Composer';
import { type ChatError, type ChatState, marksFor, type Turn } from './chatState';
import { DisputeSheet } from './DisputeSheet';
import { GoalPanel } from './Goal';
import { LearnerMessage, TutorMessage } from './Messages';
import { m } from './messages';
import { Summary } from './Summary';
import { peekKey, useChat, usePeek } from './useChat';
import { useStickToBottom } from './useStickToBottom';

/** The visible height between the top safe area and the tab bar. */
const SCREEN_HEIGHT =
  'h-[calc(100dvh-4.5rem-env(safe-area-inset-bottom)-env(safe-area-inset-top))]';

function failureText(turn: Extract<Turn, { phase: 'failed' }>): string {
  if (turn.code === 'network') return m.t('turn.failedNetwork');
  if (turn.code === 'rate_limited') {
    const s = turn.details.retryAfterSeconds;
    return typeof s === 'number'
      ? m.t('turn.rateLimitedSeconds', { seconds: s })
      : m.t('turn.rateLimited');
  }
  return m.t('turn.failed');
}

function budgetText(state: ChatState): string {
  const at = state.budget.resetsAt;
  if (!at) return m.t('composer.budget');
  const time = new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return m.t('composer.budgetAt', { time });
}

function Header({
  title,
  subtitle,
  action,
}: {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-3 border-b border-border px-gutter py-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-fg">{t('screens.chat')}</h1>
        {title && (
          <p className="truncate text-base text-fg-muted">
            {title}
            {subtitle && (
              <>
                {' · '}
                <span lang="sk">{subtitle}</span>
              </>
            )}
          </p>
        )}
      </div>
      {action}
    </header>
  );
}

export function ChatScreen() {
  const { conversationId = '' } = useParams({ strict: false });
  const online = useOnline();
  const toast = useToast();
  const { query, state, send, retry, setErrorStatus, end, ending, summary } =
    useChat(conversationId);
  const { peeks, peek } = usePeek(conversationId);
  const [disputing, setDisputing] = useState<ChatError | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const last = state?.messages.at(-1);
  // Anything that changes the height of the list: a message, a delta, a mark, a note.
  const version = [
    state?.messages.length,
    last?.content.length,
    last?.state,
    state?.errors.map((e) => e.status).join(),
    state?.turn.phase,
    Object.values(peeks)
      .map((p) => p.status)
      .join(),
  ].join('|');
  const scroll = useStickToBottom(listRef, version);

  if (!state) {
    if (query.isError) {
      const notFound = isApiError(query.error) && query.error.code === 'not_found';
      return (
        <div className="flex flex-col">
          <Header />
          <div className="px-gutter py-6" role={notFound ? undefined : 'alert'}>
            {notFound ? (
              <EmptyState
                title={m.t('chat.notFound')}
                action={
                  <Link to="/tutor" className="font-medium text-primary underline">
                    {m.t('chat.backToScenarios')}
                  </Link>
                }
              />
            ) : !online ? (
              <EmptyState title={m.t('offline.title')} description={m.t('offline.description')} />
            ) : (
              <EmptyState
                title={m.t('chat.loadFailed')}
                action={<Button onClick={() => query.refetch()}>{m.t('chat.retryLoad')}</Button>}
              />
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col">
        <Header />
        <div
          className="flex flex-col gap-3 px-gutter py-6"
          aria-busy="true"
          aria-label={t('app.loading')}
          role="status"
        >
          <Skeleton height="4rem" />
          <Skeleton height="2.5rem" width="70%" />
          <Skeleton height="2.5rem" width="60%" className="self-end" />
        </div>
      </div>
    );
  }

  const scenario = query.data?.scenario;
  const turn = state.turn;
  const busy = turn.phase === 'sending' || turn.phase === 'streaming';
  const composerOff = !online || state.budget.exhausted;
  const serverOff = !online;

  const onEnd = async () => {
    const ok = await end();
    if (!ok) toast({ title: m.t('chat.endFailed'), tone: 'error' });
  };

  if (summary && scenario) {
    return (
      <div className="flex flex-col">
        <Header title={scenario.titleEn} subtitle={scenario.titleSk} />
        <Summary
          summary={summary.summary}
          cardsCreated={summary.cardsCreated}
          scenario={scenario}
        />
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${SCREEN_HEIGHT}`}>
      <Header
        {...(scenario ? { title: scenario.titleEn, subtitle: scenario.titleSk } : {})}
        action={
          !state.ended && (
            <Button
              variant="secondary"
              disabled={busy || serverOff}
              loading={ending}
              onClick={onEnd}
            >
              {ending ? m.t('chat.ending') : m.t('chat.end')}
            </Button>
          )
        }
      />
      <ol
        ref={listRef}
        onScroll={scroll.onScroll}
        aria-label={m.t('chat.messagesLabel')}
        aria-busy={busy || undefined}
        data-chat-list=""
        className="relative flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto overscroll-contain px-gutter pb-4"
      >
        {scenario && (
          <li className="list-none">
            <GoalPanel scenario={scenario} met={state.criteriaMet} />
          </li>
        )}
        {state.messages.map((msg) =>
          msg.role === 'learner' ? (
            <LearnerMessage
              key={msg.key}
              message={msg}
              marks={marksFor(state, msg.id)}
              peeks={peeks}
              disabled={serverOff}
              onPeek={(kind, errorId) => peek(kind, { errorId })}
              onDispute={setDisputing}
            />
          ) : (
            <TutorMessage
              key={msg.key}
              message={msg}
              disabled={serverOff}
              translation={msg.id ? peeks[peekKey('translate', msg.id)] : undefined}
              onTranslate={(messageId) => peek('translate', { messageId })}
            />
          ),
        )}
      </ol>

      {turn.phase === 'failed' && !state.budget.exhausted && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-t border-border bg-wrong-soft px-gutter py-2"
        >
          <p className="text-base text-fg">{failureText(turn)}</p>
          <Button variant="secondary" disabled={serverOff} onClick={() => void retry()}>
            {m.t('turn.retry')}
          </Button>
        </div>
      )}
      {state.ended ? (
        <p className="border-t border-border px-gutter py-3 text-base text-fg-muted" role="status">
          {m.t('chat.ended')}{' '}
          <Link to="/tutor" className="font-medium text-primary underline">
            {m.t('chat.backToScenarios')}
          </Link>
        </p>
      ) : (
        <>
          {composerOff && (
            <p
              role="status"
              className="border-t border-border bg-surface-2 px-gutter py-2 text-base text-fg"
            >
              {!online ? m.t('composer.offline') : budgetText(state)}
            </p>
          )}
          <Composer
            off={composerOff}
            canSend={turn.phase === 'idle'}
            onSend={(text) => {
              scroll.toBottom();
              void send(text);
            }}
          />
        </>
      )}
      <DisputeSheet
        error={disputing}
        onClose={() => setDisputing(null)}
        onDisputed={(id) => setErrorStatus(id, 'disputed')}
      />
    </div>
  );
}

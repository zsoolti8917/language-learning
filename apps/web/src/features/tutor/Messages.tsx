// The messages of the chat: the learner's own text with its error marks, and the tutor's replies.
// Model output is plain text: React text nodes only, never HTML or Markdown.
import type { TutorErrorStatus } from '@app/contracts';
import { Link } from '@tanstack/react-router';
import { Button, cn } from '../../ui';
import type { ChatError, ChatMessage } from './chatState';
import { splitMarks } from './marks';
import { m } from './messages';
import { type PeekState, peekKey } from './useChat';

const MARK_CLASSES: Record<TutorErrorStatus, string> = {
  prompted: 'decoration-wrong decoration-wavy',
  self_corrected: 'decoration-correct decoration-solid',
  corrected: 'decoration-close decoration-double',
  disputed: 'decoration-fg-muted decoration-dotted',
  summary_only: '',
};

const MARK_SR: Record<TutorErrorStatus, string> = {
  prompted: m.messages.marks.srPrompted,
  self_corrected: m.messages.marks.srSelfCorrected,
  corrected: m.messages.marks.srCorrected,
  disputed: m.messages.marks.srDisputed,
  summary_only: '',
};

/** The learner's text with each shown error underlined; the state is also said in words. */
export function MarkedText({ text, marks }: { text: string; marks: readonly ChatError[] }) {
  return (
    <>
      {splitMarks(text, marks).map((seg) =>
        seg.mark ? (
          <span key={seg.start}>
            <span
              data-mark={seg.mark.status}
              data-error-id={seg.mark.id}
              className={cn(
                'underline decoration-2 underline-offset-4',
                MARK_CLASSES[seg.mark.status],
              )}
            >
              {seg.text}
            </span>
            <span className="sr-only"> {MARK_SR[seg.mark.status]}</span>
          </span>
        ) : (
          <span key={seg.start}>{seg.text}</span>
        ),
      )}
    </>
  );
}

export interface ErrorNoteActions {
  peeks: Record<string, PeekState>;
  onPeek: (kind: 'hint' | 'answer', errorId: string) => void;
  onDispute: (error: ChatError) => void;
  /** Peeks and disputes need the server; switched off when it cannot be reached. */
  disabled?: boolean;
}

function PeekText({ state }: { state: PeekState | undefined }) {
  if (!state || state.status === 'loading') return null;
  if (state.status === 'error') {
    return <p className="text-sm text-wrong">{m.t('marks.peekFailed')}</p>;
  }
  return (
    <p lang="sk" className="whitespace-pre-wrap rounded-control bg-surface-2 px-3 py-2 text-base">
      {state.text}
    </p>
  );
}

function ErrorNote({
  error,
  peeks,
  onPeek,
  onDispute,
  disabled,
}: { error: ChatError } & ErrorNoteActions) {
  const hint = peeks[peekKey('hint', error.id)];
  const answer = peeks[peekKey('answer', error.id)];
  return (
    <li data-note={error.status} data-error-id={error.id} className="flex flex-col gap-2 text-base">
      {error.status === 'prompted' && (
        <>
          <p className="text-fg">
            <span aria-hidden="true" className="mr-1 font-bold text-wrong">
              ?
            </span>
            {m.t('marks.prompted', { given: error.given })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={disabled}
              loading={hint?.status === 'loading'}
              onClick={() => onPeek('hint', error.id)}
            >
              {m.t('marks.hint')}
            </Button>
            <Button
              variant="ghost"
              disabled={disabled}
              loading={answer?.status === 'loading'}
              onClick={() => onPeek('answer', error.id)}
            >
              {m.t('marks.answer')}
            </Button>
          </div>
          <PeekText state={hint} />
          <PeekText state={answer} />
        </>
      )}
      {error.status === 'self_corrected' && (
        <p className="text-fg">
          <span aria-hidden="true" className="mr-1 font-bold text-correct">
            ✓
          </span>
          {m.t('marks.selfCorrected', { given: error.given })}
        </p>
      )}
      {error.status === 'corrected' && (
        <>
          <p className="text-fg">
            <span aria-hidden="true" className="mr-1 font-bold text-close">
              ≈
            </span>
            {m.t('marks.corrected', { given: error.given, expected: error.expected ?? '' })}
          </p>
          {error.explanationEn && (
            <p className="whitespace-pre-wrap text-fg-muted">{error.explanationEn}</p>
          )}
          <div>
            <Button variant="ghost" disabled={disabled} onClick={() => onDispute(error)}>
              {m.t('marks.looksWrong')}
            </Button>
          </div>
        </>
      )}
      {error.status === 'disputed' && (
        <p className="text-fg-muted">{m.t('marks.disputed', { given: error.given })}</p>
      )}
    </li>
  );
}

export function LearnerMessage({
  message,
  marks,
  ...actions
}: { message: ChatMessage; marks: readonly ChatError[] } & ErrorNoteActions) {
  return (
    <li data-role="learner" data-state={message.state} className="flex flex-col items-end gap-2">
      <span className="sr-only">{m.t('chat.you')}</span>
      <p
        lang="sk"
        className={cn(
          'max-w-[85%] whitespace-pre-wrap break-words rounded-card bg-primary-soft px-4 py-2 text-reading text-fg',
          message.state === 'failed' && 'border-2 border-dashed border-wrong',
        )}
      >
        <MarkedText text={message.content} marks={marks} />
      </p>
      {message.state === 'pending' && (
        <p className="text-sm text-fg-muted">{m.t('chat.sending')}</p>
      )}
      {marks.length > 0 && (
        <ul
          aria-label={m.t('marks.listLabel')}
          className="flex w-full max-w-[85%] flex-col gap-3 rounded-card border border-border bg-surface px-4 py-3"
        >
          {marks.map((e) => (
            <ErrorNote key={e.id} error={e} {...actions} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function TutorMessage({
  message,
  translation,
  onTranslate,
  disabled,
}: {
  message: ChatMessage;
  translation: PeekState | undefined;
  onTranslate: (messageId: string) => void;
  disabled?: boolean;
}) {
  const streaming = message.state === 'streaming';
  return (
    <li data-role="tutor" data-state={message.state} className="flex flex-col items-start gap-2">
      <span className="sr-only">{m.t('chat.tutor')}</span>
      <p
        lang="sk"
        className="max-w-[85%] whitespace-pre-wrap break-words rounded-card border border-border bg-surface px-4 py-2 text-reading text-fg"
      >
        {message.content}
        {streaming && (
          <span
            aria-hidden="true"
            className="ml-1 inline-block animate-pulse motion-reduce:animate-none"
          >
            ▍
          </span>
        )}
      </p>
      {streaming && message.content === '' && (
        <p className="text-sm text-fg-muted">{m.t('chat.typing')}</p>
      )}
      {message.cardsCreated.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {message.cardsCreated.map((noteId) => (
            <li key={noteId}>
              <Link
                to="/deck/$noteId"
                params={{ noteId }}
                data-card-chip=""
                className="inline-flex min-h-tap items-center gap-1 rounded-full border border-correct bg-correct-soft px-3 text-sm font-semibold text-correct"
              >
                <span aria-hidden="true">+</span>
                {m.t('chat.cardAdded')}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {message.id && message.role === 'tutor' && !streaming && (
        <div className="flex max-w-[85%] flex-col items-start gap-1">
          {translation?.status !== 'done' && (
            <Button
              variant="ghost"
              disabled={disabled}
              loading={translation?.status === 'loading'}
              onClick={() => message.id && onTranslate(message.id)}
            >
              {m.t('chat.translate')}
            </Button>
          )}
          {translation?.status === 'done' && (
            <p className="whitespace-pre-wrap text-base text-fg-muted">
              <span className="sr-only">{m.t('chat.translation')}: </span>
              {translation.text}
            </p>
          )}
          {translation?.status === 'error' && (
            <p className="text-sm text-wrong">{m.t('marks.peekFailed')}</p>
          )}
        </div>
      )}
    </li>
  );
}

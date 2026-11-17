// The running chat as a small reducer: messages, error marks, goal ticks and the turn in flight.
// Stream events map onto actions one to one (see turn.ts); the screen only renders this state.
import type {
  ConversationDetail,
  ErrorType,
  TutorErrorStatus,
  TutorStreamEvent,
} from '@app/contracts';
import type { ApiErrorCode } from '../../lib/api';

type AnalysisData = Extract<TutorStreamEvent, { event: 'analysis' }>['data'];
type DoneData = Extract<TutorStreamEvent, { event: 'done' }>['data'];

export interface ChatMessage {
  /** Stable key: the server id, or the client id of a learner message, or `reply:<clientId>`. */
  key: string;
  /** The server id, once known. A learner message's id arrives with `analysis`. */
  id: string | null;
  role: 'tutor' | 'learner' | 'system_note';
  content: string;
  /** `pending`: sent, no answer yet. `streaming`: the reply is growing. `failed`: no answer. */
  state: 'sent' | 'pending' | 'streaming' | 'failed';
  /** The turn this message belongs to (learner message and reply of one send). */
  clientId?: string;
  /** Notes created from corrections in this turn (tutor replies only). */
  cardsCreated: string[];
}

/** An error mark as the chat shows it. `expected` is present only once corrected. */
export interface ChatError {
  id: string;
  messageId: string;
  start: number;
  end: number;
  given: string;
  errorType: ErrorType;
  status: TutorErrorStatus;
  expected?: string;
  explanationEn?: string;
}

export type TurnFailure = {
  code: ApiErrorCode | 'stream';
  message: string;
  details: Record<string, unknown>;
};

export type Turn =
  | { phase: 'idle' }
  | { phase: 'sending'; clientId: string; content: string }
  | { phase: 'streaming'; clientId: string; content: string }
  | ({ phase: 'failed'; clientId: string; content: string } & TurnFailure);

export interface ChatState {
  conversationId: string;
  messages: ChatMessage[];
  errors: ChatError[];
  criteriaMet: string[];
  remainingUsd: number | null;
  /** Set once the daily budget is used up; the composer stays off. */
  budget: { exhausted: boolean; resetsAt?: string };
  turn: Turn;
  ended: boolean;
}

export type ChatAction =
  | { type: 'init'; detail: ConversationDetail }
  | { type: 'send'; clientId: string; content: string }
  | { type: 'analysis'; clientId: string; data: AnalysisData }
  | { type: 'delta'; clientId: string; text: string }
  | { type: 'done'; clientId: string; data: DoneData }
  | ({ type: 'failed'; clientId: string } & TurnFailure)
  | { type: 'errorStatus'; errorId: string; status: TutorErrorStatus }
  | { type: 'ended' };

/** Error marks shown in the chat. `summary_only` slips wait for the end summary. */
export const SHOWN_STATUSES: readonly TutorErrorStatus[] = [
  'prompted',
  'self_corrected',
  'corrected',
  'disputed',
];

const replyKey = (clientId: string) => `reply:${clientId}`;

export function initialChat(detail: ConversationDetail): ChatState {
  return {
    conversationId: detail.conversation.id,
    messages: [...detail.messages]
      .sort((a, b) => a.seq - b.seq)
      .map((msg) => ({
        key: msg.id,
        id: msg.id,
        role: msg.role,
        content: msg.content,
        state: 'sent' as const,
        cardsCreated: [],
      })),
    errors: detail.errors.map((e) => ({
      id: e.id,
      messageId: e.messageId,
      start: e.start,
      end: e.end,
      given: e.given,
      errorType: e.errorType,
      status: e.status,
      ...(e.expected !== undefined ? { expected: e.expected } : {}),
      ...(e.explanationEn !== undefined ? { explanationEn: e.explanationEn } : {}),
    })),
    criteriaMet: [...detail.conversation.goalState.criteriaMet],
    remainingUsd: null,
    budget: { exhausted: false },
    turn: { phase: 'idle' },
    ended: detail.conversation.status !== 'active',
  };
}

function upsertError(errors: ChatError[], next: ChatError): ChatError[] {
  const i = errors.findIndex((e) => e.id === next.id);
  if (i === -1) return [...errors, next];
  const copy = errors.slice();
  copy[i] = next;
  return copy;
}

function updateMessage(
  messages: ChatMessage[],
  key: string,
  fn: (m: ChatMessage) => ChatMessage,
): ChatMessage[] {
  return messages.map((msg) => (msg.key === key ? fn(msg) : msg));
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'init':
      return initialChat(action.detail);

    case 'send': {
      const { clientId, content } = action;
      const existing = state.messages.find((msg) => msg.key === clientId);
      let messages: ChatMessage[];
      let errors = state.errors;
      if (existing) {
        // A retry: the same learner message, sent again with the same client id. Drop the
        // partial reply and the marks of the failed attempt; the new analysis brings them back.
        messages = state.messages
          .filter((msg) => msg.key !== replyKey(clientId))
          .map((msg) => (msg.key === clientId ? { ...msg, state: 'pending' as const } : msg));
        if (existing.id) errors = errors.filter((e) => e.messageId !== existing.id);
      } else {
        messages = [
          ...state.messages,
          {
            key: clientId,
            id: null,
            role: 'learner',
            content,
            state: 'pending',
            clientId,
            cardsCreated: [],
          },
        ];
      }
      return { ...state, messages, errors, turn: { phase: 'sending', clientId, content } };
    }

    case 'analysis': {
      const { clientId, data } = action;
      let errors = state.errors.filter((e) => e.messageId !== data.messageId);
      for (const e of data.errors) {
        errors = upsertError(errors, {
          id: e.id,
          messageId: data.messageId,
          start: e.start,
          end: e.end,
          given: e.given,
          errorType: e.errorType,
          status: e.status,
          ...(e.expected !== undefined ? { expected: e.expected } : {}),
          ...(e.explanationEn !== undefined ? { explanationEn: e.explanationEn } : {}),
        });
      }
      for (const r of data.resolved) {
        errors = errors.map((e) =>
          e.id === r.id
            ? {
                ...e,
                status: r.status,
                ...(r.expected !== undefined ? { expected: r.expected } : {}),
                ...(r.explanationEn !== undefined ? { explanationEn: r.explanationEn } : {}),
              }
            : e,
        );
      }
      const messages = updateMessage(state.messages, clientId, (msg) => ({
        ...msg,
        id: data.messageId,
        state: 'sent',
      })).filter((msg) => msg.key !== replyKey(clientId));
      messages.push({
        key: replyKey(clientId),
        id: null,
        role: 'tutor',
        content: '',
        state: 'streaming',
        clientId,
        cardsCreated: [],
      });
      const content = state.turn.phase === 'idle' ? '' : state.turn.content;
      return { ...state, messages, errors, turn: { phase: 'streaming', clientId, content } };
    }

    case 'delta': {
      const key = replyKey(action.clientId);
      const has = state.messages.some((msg) => msg.key === key);
      const messages = has
        ? updateMessage(state.messages, key, (msg) => ({
            ...msg,
            content: msg.content + action.text,
          }))
        : [
            ...state.messages,
            {
              key,
              id: null,
              role: 'tutor' as const,
              content: action.text,
              state: 'streaming' as const,
              clientId: action.clientId,
              cardsCreated: [],
            },
          ];
      return { ...state, messages };
    }

    case 'done': {
      const { clientId, data } = action;
      const key = replyKey(clientId);
      const reply: ChatMessage = {
        key,
        id: data.tutorMessage.id,
        role: 'tutor',
        // The stored text is the truth; the deltas only showed it growing.
        content: data.tutorMessage.content,
        state: 'sent',
        clientId,
        cardsCreated: [...data.cardsCreated],
      };
      const has = state.messages.some((msg) => msg.key === key);
      const messages = (
        has ? updateMessage(state.messages, key, () => reply) : [...state.messages, reply]
      ).map((msg) =>
        msg.key === clientId && msg.state !== 'sent' ? { ...msg, state: 'sent' as const } : msg,
      );
      return {
        ...state,
        messages,
        criteriaMet: [...data.goal.criteriaMet],
        remainingUsd: data.budget.remainingUsd,
        turn: { phase: 'idle' },
      };
    }

    case 'failed': {
      const { clientId, code, message, details } = action;
      // No half shown reply: the partial text of this turn goes.
      const messages = state.messages
        .filter((msg) => msg.key !== replyKey(clientId))
        .map((msg) => (msg.key === clientId ? { ...msg, state: 'failed' as const } : msg));
      const content =
        state.turn.phase === 'idle'
          ? (state.messages.find((msg) => msg.key === clientId)?.content ?? '')
          : state.turn.content;
      const budget =
        code === 'budget_exceeded'
          ? {
              exhausted: true,
              ...(typeof details.resetsAt === 'string' ? { resetsAt: details.resetsAt } : {}),
            }
          : state.budget;
      return {
        ...state,
        messages,
        budget,
        turn: { phase: 'failed', clientId, content, code, message, details },
      };
    }

    case 'errorStatus':
      return {
        ...state,
        errors: state.errors.map((e) =>
          e.id === action.errorId ? { ...e, status: action.status } : e,
        ),
      };

    case 'ended':
      return { ...state, ended: true, turn: { phase: 'idle' } };
  }
}

/** The marks of one learner message that the chat shows. */
export function marksFor(state: ChatState, messageId: string | null): ChatError[] {
  if (!messageId) return [];
  return state.errors.filter((e) => e.messageId === messageId && SHOWN_STATUSES.includes(e.status));
}

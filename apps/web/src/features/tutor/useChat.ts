// The chat's data: the conversation from the server, the running turn, peeks, dispute and end.
import type { PeekKind, TutorSummary } from '@app/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { api, apiKey, apiQuery } from '../../lib/api';
import { newId } from '../../lib/ids';
import { type ChatAction, type ChatState, chatReducer, initialChat } from './chatState';
import { prepareMessage, runTurn } from './turn';

function reducer(state: ChatState | null, action: ChatAction): ChatState | null {
  if (action.type === 'init') return initialChat(action.detail);
  return state ? chatReducer(state, action) : state;
}

/** Query keys the tutor refreshes after a turn or the end. */
export const TUTOR_LIST_KEYS = [
  ['api', 'tutor.listConversations'],
  ['api', 'tutor.scenarios'],
] as const;

export function useChat(conversationId: string) {
  const queryClient = useQueryClient();
  const query = useQuery(apiQuery('tutor.getConversation', { params: { id: conversationId } }));
  const [state, dispatch] = useReducer(reducer, null);
  const initialised = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  // Start from the server's copy once per visit. Cached data that is stale waits for the refetch.
  const ready = !!query.data && (query.isFetchedAfterMount || !query.isStale);
  useEffect(() => {
    if (ready && query.data && initialised.current !== conversationId) {
      initialised.current = conversationId;
      dispatch({ type: 'init', detail: query.data });
    }
  }, [ready, query.data, conversationId]);

  useEffect(
    () => () => {
      controller.current?.abort();
      // The chat changed the conversation: the next visit fetches it again.
      void queryClient.invalidateQueries({
        queryKey: apiKey('tutor.getConversation', { params: { id: conversationId } }),
        refetchType: 'none',
      });
    },
    [queryClient, conversationId],
  );

  const turnTo = useCallback(
    async (content: string, clientId: string) => {
      controller.current?.abort();
      const ctrl = new AbortController();
      controller.current = ctrl;
      await runTurn(api, { conversationId, clientId, content, signal: ctrl.signal }, dispatch);
      if (!ctrl.signal.aborted) {
        for (const queryKey of TUTOR_LIST_KEYS) void queryClient.invalidateQueries({ queryKey });
      }
    },
    [conversationId, queryClient],
  );

  /** Sends a new learner message. Resolves when the turn is over. */
  const send = useCallback(
    (text: string) => {
      const content = prepareMessage(text);
      if (!content) return Promise.resolve();
      return turnTo(content, newId());
    },
    [turnTo],
  );

  /** Sends the failed message again with the same client id, so it is stored once. */
  const retry = useCallback(() => {
    const turn = state?.turn;
    if (turn?.phase !== 'failed') return Promise.resolve();
    return turnTo(turn.content, turn.clientId);
  }, [state?.turn, turnTo]);

  const setErrorStatus = useCallback(
    (errorId: string, status: 'disputed') => dispatch({ type: 'errorStatus', errorId, status }),
    [],
  );

  const [summary, setSummary] = useState<{ summary: TutorSummary; cardsCreated: number } | null>(
    null,
  );
  const [ending, setEnding] = useState(false);
  const end = useCallback(async () => {
    setEnding(true);
    try {
      const result = await api.tutor.end({ params: { id: conversationId } });
      setSummary(result);
      dispatch({ type: 'ended' });
      for (const queryKey of TUTOR_LIST_KEYS) void queryClient.invalidateQueries({ queryKey });
      return true;
    } catch {
      return false;
    } finally {
      setEnding(false);
    }
  }, [conversationId, queryClient]);

  return { query, state, send, retry, setErrorStatus, end, ending, summary };
}

export type PeekState =
  | { status: 'loading' }
  | { status: 'done'; text: string }
  | { status: 'error' };

/** Peeks: a translation of a tutor message, or a hint or the answer for an open error. */
export function usePeek(conversationId: string) {
  const [peeks, setPeeks] = useState<Record<string, PeekState>>({});
  const peek = useCallback(
    async (kind: PeekKind, target: { messageId: string } | { errorId: string }) => {
      const key = peekKey(kind, 'messageId' in target ? target.messageId : target.errorId);
      setPeeks((p) => ({ ...p, [key]: { status: 'loading' } }));
      try {
        const { text } = await api.tutor.peek({
          params: { id: conversationId },
          body: { kind, ...target },
        });
        setPeeks((p) => ({ ...p, [key]: { status: 'done', text } }));
      } catch {
        setPeeks((p) => ({ ...p, [key]: { status: 'error' } }));
      }
    },
    [conversationId],
  );
  return { peeks, peek };
}

export function peekKey(kind: PeekKind, id: string): string {
  return `${kind}:${id}`;
}

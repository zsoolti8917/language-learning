// The session hook: loads the queue, runs the reducer, stores every answer.
import type { Rating } from '@app/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { loadProfile } from '../../lib/auth';
import { newId } from '../../lib/ids';
import { initialSession, type SessionOptions, sessionReducer } from './session';
import {
  defaultDeps,
  type LoadError,
  loadQueue,
  QueueLoadError,
  type ReviewDeps,
  recordAnswer,
} from './store';

export type LoadState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; reason: LoadError };

export function useReviewSession(deps: ReviewDeps = defaultDeps, now: () => number = Date.now) {
  const queryClient = useQueryClient();
  const [session, dispatch] = useReducer(sessionReducer, initialSession);
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const stored = useRef(new Set<string>());

  const start = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      setLoad({ status: 'loading' });
      try {
        const [queue, profile] = await Promise.all([
          loadQueue(deps),
          loadProfile(queryClient).catch(() => null),
        ]);
        if (isCancelled()) return;
        const options: Partial<SessionOptions> = profile
          ? {
              strictDiacritics: profile.strictDiacritics,
              desiredRetention: profile.desiredRetention,
            }
          : {};
        dispatch({
          type: 'start',
          items: queue.items,
          counts: queue.counts,
          consumed: queue.consumed,
          options,
          now: now(),
        });
        setLoad({ status: 'ready' });
      } catch (e) {
        if (isCancelled()) return;
        setLoad({
          status: 'error',
          reason: e instanceof QueueLoadError ? e.reason : 'failed',
        });
      }
    },
    [deps, queryClient, now],
  );

  useEffect(() => {
    let cancelled = false;
    void start(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [start]);

  // Each answer goes to the local queue and the outbox exactly once.
  const last = session.last;
  useEffect(() => {
    if (!last || stored.current.has(last.answer.id)) return;
    stored.current.add(last.answer.id);
    recordAnswer(last, deps).catch((e) => console.warn('review: answer not stored', e));
  }, [last, deps]);

  return {
    session,
    load,
    reload: () => start(),
    type: (value: string) => dispatch({ type: 'type', value }),
    submit: () => dispatch({ type: 'submit', now: now() }),
    reveal: () => dispatch({ type: 'reveal', now: now() }),
    rate: (rating?: Rating) =>
      dispatch({ type: 'rate', id: newId(), now: now(), ...(rating ? { rating } : {}) }),
  };
}

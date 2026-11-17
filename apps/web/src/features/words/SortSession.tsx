// Sorting mode: one new word at a time with its meaning hidden, then Known, Learn or Ignore by
// button or swipe. Decisions go to the outbox in batches of 20; the last one can be undone.
// Works offline for a band fetched before (the deck is kept in the local database).
import type { ResponseOf, TriageDecision, WordListItem } from '@app/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type PointerEvent, useEffect, useRef, useState } from 'react';
import { api, isApiError } from '../../lib/api';
import { db, kvGet, kvSet, outbox, useOutbox } from '../../lib/db';
import { useOnline } from '../../lib/pwa';
import { Button, Card, EmptyState } from '../../ui';
import { m } from './messages';
import { ErrorState, LoadingState } from './states';
import { TriageBatcher } from './triage';

type WordList = ResponseOf<'words.list'>;

const DECK_LIMIT = 200;
/** Pixels a card must travel before a swipe counts. */
export const SWIPE_DISTANCE = 80;

const deckKey = (band: number) => `words.sortDeck.${band}`;

/** The new words of a band; the last fetched copy when the network is down. */
async function loadDeck(band: number, signal: AbortSignal): Promise<WordList> {
  try {
    const list = await api.words.list(
      { query: { band, status: 'unknown', limit: DECK_LIMIT } },
      { signal },
    );
    await kvSet(deckKey(band), list).catch(() => {});
    return list;
  } catch (e) {
    if (isApiError(e) && e.isNetwork) {
      const stored = await kvGet<WordList>(deckKey(band)).catch(() => undefined);
      if (stored) return stored;
    }
    throw e;
  }
}

/** Drops words the learner sorted on this device whose decision has not reached the list yet. */
async function unsorted(items: WordListItem[]): Promise<WordListItem[]> {
  const local = await db.lemmaStatus.bulkGet(items.map((w) => w.lemmaId)).catch(() => []);
  return items.filter((_, i) => {
    const s = local[i]?.status;
    return s === undefined || s === 'unknown';
  });
}

export function SortSession({ band, onExit }: { band: number; onExit: () => void }) {
  const queryClient = useQueryClient();
  const online = useOnline();
  const { pending } = useOutbox();
  const deckQuery = useQuery({
    queryKey: ['words', 'sortDeck', band],
    queryFn: ({ signal }) => loadDeck(band, signal),
    gcTime: 0,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const batcher = useRef<TriageBatcher | null>(null);
  batcher.current ??= new TriageBatcher();
  const [deck, setDeck] = useState<WordListItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);

  // The deck is fixed when the session starts, so it does not move under the learner.
  useEffect(() => {
    if (!deckQuery.data || deck) return;
    let live = true;
    const b = batcher.current as TriageBatcher;
    void b
      .recover()
      .catch(() => 0)
      .then(() => unsorted(deckQuery.data.items))
      .then((items) => {
        if (!live) return;
        setDeck(items);
        setCursor(deckQuery.data.nextCursor);
      });
    return () => {
      live = false;
    };
  }, [deckQuery.data, deck]);

  // Leaving the sorting mode (or the app) sends the waiting batch, however small.
  useEffect(() => {
    const b = batcher.current as TriageBatcher;
    const leave = () => {
      void b
        .leave()
        .then((n) => (n > 0 ? outbox.flush() : undefined))
        .catch(() => {})
        .finally(() => {
          void queryClient.invalidateQueries({ queryKey: ['api', 'words.list'] });
          void queryClient.invalidateQueries({ queryKey: ['api', 'words.bands'] });
        });
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') leave();
    };
    window.addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', leave);
      document.removeEventListener('visibilitychange', onHide);
      leave();
    };
  }, [queryClient]);

  if (deckQuery.isError) {
    return (
      <div className="mt-5">
        {isApiError(deckQuery.error) && deckQuery.error.isNetwork ? (
          <EmptyState
            title={m.t('common.offline')}
            description={m.t('sort.offlineNoDeck')}
            action={
              <Button variant="secondary" onClick={onExit}>
                {m.t('sort.finish')}
              </Button>
            }
          />
        ) : (
          <ErrorState error={deckQuery.error} onRetry={() => void deckQuery.refetch()} />
        )}
      </div>
    );
  }
  if (!deck) {
    return (
      <div className="mt-5">
        <LoadingState rows={1} />
      </div>
    );
  }

  const word = deck[index];
  const total = deck.length;

  const decide = (decision: TriageDecision) => {
    if (!word) return;
    setIndex((i) => i + 1);
    setRevealed(false);
    setCanUndo(true);
    setAnnounce(
      m.t('sort.decided', { lemma: word.lemma, decision: m.t(DECISION_LABEL[decision]) }),
    );
    void (batcher.current as TriageBatcher).decide(word.lemmaId, decision);
  };

  const undo = async () => {
    const last = await (batcher.current as TriageBatcher).undo();
    if (!last) {
      setCanUndo(false);
      return;
    }
    const at = deck.findIndex((w) => w.lemmaId === last.lemmaId);
    if (at >= 0) setIndex(at);
    setRevealed(false);
    setCanUndo((batcher.current as TriageBatcher).pending.length > 0);
    setAnnounce(m.t('sort.undone', { lemma: deck[at]?.lemma ?? '' }));
  };

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const next = await api.words.list({
        query: { band, status: 'unknown', limit: DECK_LIMIT, cursor },
      });
      const fresh = await unsorted(next.items);
      setDeck((d) => [
        ...(d ?? []),
        ...fresh.filter((w) => !d?.some((x) => x.lemmaId === w.lemmaId)),
      ]);
      setCursor(next.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-base font-semibold text-fg" aria-live="off">
          {m.t('sort.counter', { done: Math.min(index, total), total })}
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={!canUndo} onClick={() => void undo()}>
            {m.t('sort.undo')}
          </Button>
          <Button variant="ghost" onClick={onExit}>
            {m.t('sort.finish')}
          </Button>
        </div>
      </div>
      {!online && pending > 0 && (
        <p className="mt-1 text-sm text-fg-muted">{m.t('sort.waiting', { count: pending })}</p>
      )}
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      <div className="mt-4">
        {word ? (
          <SortCard
            key={word.lemmaId}
            word={word}
            revealed={revealed}
            onReveal={() => setRevealed(true)}
            onDecide={decide}
          />
        ) : total === 0 && !cursor ? (
          <EmptyState
            title={m.t('sort.nothing')}
            description={m.t('sort.nothingHint')}
            action={<Button onClick={onExit}>{m.t('sort.finish')}</Button>}
          />
        ) : (
          <EmptyState
            title={m.t('sort.done')}
            description={m.t('sort.doneHint')}
            action={
              cursor ? (
                <Button loading={loadingMore} onClick={() => void loadMore()}>
                  {m.t('sort.loadMore')}
                </Button>
              ) : (
                <Button onClick={onExit}>{m.t('sort.finish')}</Button>
              )
            }
          />
        )}
      </div>

      {word && (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Button variant="secondary" size="lg" onClick={() => decide('learn')}>
              {m.t('sort.learn')}
            </Button>
            <Button variant="ghost" size="lg" onClick={() => decide('ignored')}>
              {m.t('sort.ignore')}
            </Button>
            <Button size="lg" onClick={() => decide('known')}>
              {m.t('sort.known')}
            </Button>
          </div>
          <p className="mt-2 text-center text-sm text-fg-muted">{m.t('sort.swipeHint')}</p>
        </>
      )}
    </div>
  );
}

const DECISION_LABEL = {
  known: 'sort.known',
  learn: 'sort.learn',
  ignored: 'sort.ignore',
} as const;

/** The direction of a finished drag, or null when it was too short. */
export function swipeDecision(dx: number, dy: number): TriageDecision | null {
  if (-dy > SWIPE_DISTANCE && Math.abs(dy) > Math.abs(dx)) return 'ignored';
  if (dx > SWIPE_DISTANCE) return 'known';
  if (dx < -SWIPE_DISTANCE) return 'learn';
  return null;
}

function SortCard({
  word,
  revealed,
  onReveal,
  onDecide,
}: {
  word: WordListItem;
  revealed: boolean;
  onReveal: () => void;
  onDecide: (d: TriageDecision) => void;
}) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const [drag, setDrag] = useState({ x: 0, y: 0 });

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const next = { x: e.clientX - s.x, y: e.clientY - s.y };
    if (Math.abs(next.x) > 8 || Math.abs(next.y) > 8) {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    setDrag(next);
  };
  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    start.current = null;
    if (!s || s.id !== e.pointerId) return;
    const d = swipeDecision(e.clientX - s.x, e.clientY - s.y);
    setDrag({ x: 0, y: 0 });
    if (d) onDecide(d);
  };

  const forms = word.topForms.map((f) => f.form).filter((f) => f !== word.lemma);
  return (
    <Card
      data-testid="sort-card"
      className="touch-none select-none text-center"
      style={{ transform: `translate(${drag.x}px, ${drag.y}px) rotate(${drag.x / 25}deg)` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={() => {
        start.current = null;
        setDrag({ x: 0, y: 0 });
      }}
    >
      <p className="text-sm text-fg-muted">{m.t('band.rank', { rank: word.rank })}</p>
      <p lang="sk" className="mt-2 text-4xl font-bold text-fg" data-testid="sort-lemma">
        {word.lemma}
      </p>
      <p className="mt-1 text-sm text-fg-muted">{m.t(`pos.${word.pos}`)}</p>
      {forms.length > 0 && (
        <p lang="sk" className="mt-2 text-base text-fg-muted">
          {forms.join(' · ')}
        </p>
      )}
      <div className="mt-4 flex min-h-tap items-center justify-center">
        {revealed ? (
          <p className="text-xl text-fg" data-testid="sort-gloss">
            {word.glossEn ?? m.t('band.noGloss')}
          </p>
        ) : (
          <Button variant="ghost" onClick={onReveal} aria-label={m.t('sort.showMeaning')}>
            {m.t('sort.showMeaning')}
          </Button>
        )}
      </div>
    </Card>
  );
}

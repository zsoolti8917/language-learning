// The deck (M2): /deck. A searchable list of notes with a filter by kind.
import { NOTE_KINDS, type NoteKind, type NoteSummary } from '@app/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useOnline } from '../../lib/pwa';
import { Button, Card, EmptyState, Input, Skeleton } from '../../ui';
import { formatDate } from './format';
import { m } from './messages';

const PAGE = 50;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function deckListKey(kind: NoteKind | undefined, q: string) {
  return ['api', 'notes.list', { kind: kind ?? null, q }] as const;
}

function NoteRow({ note }: { note: NoteSummary }) {
  const status = note.suspended
    ? m.messages.deck.suspended
    : note.state === 'new'
      ? m.messages.deck.newCard
      : note.dueAt
        ? m.t('deck.due', { date: formatDate(note.dueAt) })
        : m.messages.cardStates[note.state];
  return (
    <li>
      <Card asChild compact>
        <Link to="/deck/$noteId" params={{ noteId: note.id }} data-note={note.id}>
          <span className="flex items-baseline justify-between gap-3">
            <span lang="sk" className="min-w-0 truncate text-lg font-semibold">
              {note.label}
            </span>
            <span className="shrink-0 text-sm text-fg-muted">{m.messages.kinds[note.kind]}</span>
          </span>
          <span className="flex items-baseline justify-between gap-3 text-sm text-fg-muted">
            <span className="min-w-0 truncate">{note.glossEn}</span>
            <span className="shrink-0">{status}</span>
          </span>
        </Link>
      </Card>
    </li>
  );
}

export function DeckScreen() {
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<NoteKind | undefined>(undefined);
  const q = useDebounced(search.trim(), 300);
  const online = useOnline();

  const list = useInfiniteQuery({
    queryKey: deckListKey(kind, q),
    queryFn: ({ pageParam, signal }) =>
      api.notes.list(
        {
          query: {
            limit: PAGE,
            ...(kind ? { kind } : {}),
            ...(q ? { q } : {}),
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        },
        { signal },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const notes = list.data?.pages.flatMap((p) => p.items) ?? [];

  let body: React.ReactNode;
  if (list.isPending) {
    body = (
      <div
        className="space-y-2"
        aria-busy="true"
        aria-label={m.messages.deck.loading}
        role="status"
      >
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );
  } else if (list.isError) {
    body = !online ? (
      <EmptyState title={m.messages.deck.offlineTitle} description={m.messages.deck.offlineText} />
    ) : (
      <EmptyState
        title={m.messages.deck.errorTitle}
        description={m.messages.review.errorText}
        action={<Button onClick={() => void list.refetch()}>{m.messages.review.retry}</Button>}
      />
    );
  } else if (notes.length === 0) {
    body =
      q || kind ? (
        <EmptyState title={m.messages.deck.noMatch} />
      ) : (
        <EmptyState title={m.messages.deck.emptyTitle} description={m.messages.deck.emptyText} />
      );
  } else {
    body = (
      <>
        <ul className="space-y-2" aria-label={m.messages.deck.title}>
          {notes.map((n) => (
            <NoteRow key={n.id} note={n} />
          ))}
        </ul>
        {list.hasNextPage && (
          <Button
            variant="secondary"
            block
            loading={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {m.messages.deck.more}
          </Button>
        )}
      </>
    );
  }

  const filters: (NoteKind | undefined)[] = [undefined, ...NOTE_KINDS];
  return (
    <section className="space-y-4 px-gutter py-6">
      <h1 className="text-2xl font-semibold text-fg">{m.messages.deck.title}</h1>
      <Input
        type="search"
        label={m.messages.deck.search}
        hideLabel
        placeholder={m.messages.deck.search}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      {/* biome-ignore lint/a11y/useSemanticElements: a labelled group of toggle buttons */}
      <div role="group" aria-label={m.messages.deck.filter} className="flex flex-wrap gap-2">
        {filters.map((k) => (
          <Button
            key={k ?? 'all'}
            variant={kind === k ? 'primary' : 'secondary'}
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
          >
            {k ? m.messages.kinds[k] : m.messages.deck.all}
          </Button>
        ))}
      </div>
      {body}
    </section>
  );
}

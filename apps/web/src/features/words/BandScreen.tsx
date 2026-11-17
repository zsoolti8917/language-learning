// One band: its words with a status filter, and the sorting mode (M5).
import type { LemmaStatus, WordListItem } from '@app/contracts';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { api, apiQuery } from '../../lib/api';
import { t } from '../../messages';
import { Button, Card, EmptyState, Tabs } from '../../ui';
import { m } from './messages';
import { SortSession } from './SortSession';
import { ErrorState, LoadingState } from './states';

type Filter = 'all' | LemmaStatus;
const FILTERS: Filter[] = ['all', 'unknown', 'learning', 'known', 'ignored'];

export function parseBand(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function BandScreen() {
  const { band: raw } = useParams({ strict: false });
  const band = parseBand(raw);
  const [filter, setFilter] = useState<Filter>('all');
  const [sorting, setSorting] = useState(false);
  const queryClient = useQueryClient();

  const bands = useQuery({ ...apiQuery('words.bands'), enabled: band !== null });
  const info = bands.data?.bands.find((b) => b.band === band);
  const range = info ? { from: info.fromRank, to: info.toRank } : null;

  return (
    <section className="px-gutter py-6">
      <Link
        to="/words"
        className="inline-flex min-h-tap items-center text-base font-medium text-primary underline"
      >
        ‹ {m.t('band.back')}
      </Link>
      <h1 className="text-2xl font-semibold text-fg">{t('screens.band')}</h1>
      {range && <p className="mt-1 text-base text-fg-muted">{m.t('band.range', range)}</p>}

      {band === null ? (
        <div className="mt-5">
          <EmptyState title={m.t('band.invalid')} />
        </div>
      ) : sorting ? (
        <SortSession
          band={band}
          onExit={() => {
            setSorting(false);
            void queryClient.invalidateQueries({ queryKey: ['api', 'words.list'] });
            void queryClient.invalidateQueries({ queryKey: ['api', 'words.bands'] });
          }}
        />
      ) : (
        <>
          <div className="mt-4">
            <Button block size="lg" onClick={() => setSorting(true)}>
              {m.t('band.sort')}
            </Button>
            <p className="mt-1 text-sm text-fg-muted">{m.t('band.sortHint')}</p>
          </div>
          <Tabs
            className="mt-5"
            label={m.t('band.filterLabel')}
            value={filter}
            onValueChange={(v) => setFilter(v as Filter)}
            items={FILTERS.map((f) => ({
              value: f,
              label: f === 'all' ? m.t('band.all') : m.t(`status.${f}`),
              content: <WordList band={band} status={f === 'all' ? undefined : f} />,
            }))}
          />
        </>
      )}
    </section>
  );
}

function WordList({ band, status }: { band: number; status: LemmaStatus | undefined }) {
  const list = useInfiniteQuery({
    queryKey: ['api', 'words.list', { band, status }],
    queryFn: ({ pageParam, signal }) =>
      api.words.list(
        {
          query: {
            band,
            ...(status ? { status } : {}),
            limit: 50,
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        },
        { signal },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? null,
  });

  if (list.isPending) return <LoadingState />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  const items = list.data.pages.flatMap((p) => p.items);
  if (items.length === 0) {
    return <EmptyState title={m.t('band.empty')} description={m.t('band.emptyHint')} />;
  }
  return (
    <div className="mt-3">
      <ul className="space-y-2">
        {items.map((w) => (
          <li key={w.lemmaId}>
            <WordRow word={w} />
          </li>
        ))}
      </ul>
      {list.hasNextPage && (
        <Button
          className="mt-3"
          variant="secondary"
          block
          loading={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {m.t('band.more')}
        </Button>
      )}
    </div>
  );
}

function WordRow({ word: w }: { word: WordListItem }) {
  return (
    <Card asChild compact>
      <Link
        to="/lemma/$lemmaId"
        params={{ lemmaId: String(w.lemmaId) }}
        className="flex items-center gap-3"
        data-lemma={w.lemmaId}
      >
        <span className="w-12 shrink-0 text-sm text-fg-muted">
          {m.t('band.rank', { rank: w.rank })}
        </span>
        <span className="min-w-0 flex-1">
          <span lang="sk" className="block text-lg font-semibold text-fg">
            {w.lemma}
          </span>
          <span className="block truncate text-sm text-fg-muted">
            {w.glossEn ?? m.t('band.noGloss')}
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-sm text-fg">
          {m.t(`status.${w.status}`)}
        </span>
      </Link>
    </Card>
  );
}

// /read: the learner's own texts and the starter library, each with its share of known words.
import type { LibraryItem, TextSummary } from '@app/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { api, apiQuery, isApiError } from '../../lib/api';
import { db } from '../../lib/db';
import { newId } from '../../lib/ids';
import { Button, Card, EmptyState, Skeleton } from '../../ui';
import { m } from './messages';
import { CoverageRing } from './TextStatusViews';

/** Texts opened on this device, newest first: what the library shows offline. */
async function storedTexts(): Promise<TextSummary[]> {
  const rows = await db.texts.orderBy('openedAt').reverse().toArray();
  return rows.map(({ body: _b, analysis: _a, error: _e, lemmaStatus: _l, phrases: _p, ...s }) => {
    const { openedAt: _o, ...summary } = s;
    return summary;
  });
}

export function LibraryScreen() {
  const texts = useQuery(apiQuery('texts.list', { query: { archived: 'false' } }));
  const library = useQuery(apiQuery('library.list'));
  const offline = isApiError(texts.error) && texts.error.isNetwork;
  const stored = useQuery({
    queryKey: ['reader', 'stored-texts'],
    queryFn: storedTexts,
    enabled: offline,
    networkMode: 'always',
  });

  return (
    <section className="space-y-6 px-gutter py-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-fg">{m.t('library.title')}</h1>
        <Button asChild size="md">
          <Link to="/read/import">{m.t('library.import')}</Link>
        </Button>
      </div>

      <section aria-labelledby="reader-own" className="space-y-3">
        <h2 id="reader-own" className="text-lg font-semibold text-fg">
          {m.t('library.yourTexts')}
        </h2>
        {texts.isPending ? (
          <LoadingList />
        ) : offline ? (
          <>
            <p role="status" className="text-sm text-fg-muted">
              {m.t('library.offline')}
            </p>
            {stored.data && stored.data.length > 0 ? (
              <TextList items={stored.data} />
            ) : stored.isPending ? (
              <LoadingList />
            ) : (
              <EmptyState title={m.t('library.offlineEmpty')} />
            )}
          </>
        ) : texts.isError ? (
          <EmptyState
            title={m.t('library.error')}
            action={
              <Button variant="secondary" onClick={() => void texts.refetch()}>
                {m.t('reader.retry')}
              </Button>
            }
          />
        ) : texts.data.items.length === 0 ? (
          <EmptyState
            title={m.t('library.emptyTitle')}
            description={m.t('library.emptyBody')}
            action={
              <Button asChild>
                <Link to="/read/import">{m.t('library.import')}</Link>
              </Button>
            }
          />
        ) : (
          <TextList items={texts.data.items} />
        )}
      </section>

      <section aria-labelledby="reader-starter" className="space-y-3">
        <h2 id="reader-starter" className="text-lg font-semibold text-fg">
          {m.t('library.starter')}
        </h2>
        {library.isPending ? (
          <LoadingList rows={1} />
        ) : library.isError ? (
          isApiError(library.error) && library.error.isNetwork ? null : (
            <EmptyState
              title={m.t('library.error')}
              action={
                <Button variant="secondary" onClick={() => void library.refetch()}>
                  {m.t('reader.retry')}
                </Button>
              }
            />
          )
        ) : library.data.items.length === 0 ? (
          <p className="text-base text-fg-muted">{m.t('library.starterEmpty')}</p>
        ) : (
          <ul className="space-y-2">
            {library.data.items.map((item) => (
              <li key={item.id}>
                <StarterRow item={item} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function LoadingList({ rows = 2 }: { rows?: number }) {
  return (
    <div aria-busy="true" className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={64} />
      ))}
    </div>
  );
}

function statusLine(t: TextSummary): string {
  if (t.status === 'processing') return m.t('library.processing');
  if (t.status === 'failed') return m.t('library.failed');
  return m.t('library.tokens', { count: t.tokenCount ?? 0 });
}

function TextList({ items }: { items: TextSummary[] }) {
  return (
    <ul className="space-y-2">
      {items.map((t) => (
        <li key={t.id}>
          <Card asChild compact>
            <Link
              to="/read/$textId"
              params={{ textId: t.id }}
              className="flex items-center gap-3"
              data-text-id={t.id}
            >
              <CoverageRing share={t.coverage} />
              <span className="min-w-0 flex-1">
                <span lang="sk" className="block truncate text-base font-semibold text-fg">
                  {t.title}
                </span>
                <span className="block text-sm text-fg-muted">{statusLine(t)}</span>
              </span>
            </Link>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function StarterRow({ item }: { item: LibraryItem }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [failed, setFailed] = useState(false);

  const add = async () => {
    setAdding(true);
    setFailed(false);
    try {
      const res = await api.library.add({ params: { id: item.id }, body: { id: newId() } });
      void queryClient.invalidateQueries({ queryKey: ['api', 'texts.list'] });
      void queryClient.invalidateQueries({ queryKey: ['api', 'library.list'] });
      await navigate({ to: '/read/$textId', params: { textId: res.id } });
    } catch {
      setFailed(true);
    } finally {
      setAdding(false);
    }
  };

  return (
    <Card compact className="flex items-center gap-3">
      <CoverageRing share={item.coverage} />
      <span className="min-w-0 flex-1">
        <span lang="sk" className="block truncate text-base font-semibold text-fg">
          {item.title}
        </span>
        <span className="block text-sm text-fg-muted">
          {m.t('library.starterMeta', { level: item.level, count: item.tokenCount })}
        </span>
        {failed && (
          <span role="alert" className="block text-sm text-wrong">
            {m.t('library.addFailed')}
          </span>
        )}
      </span>
      {item.textId ? (
        <Button asChild variant="secondary">
          <Link to="/read/$textId" params={{ textId: item.textId }}>
            {m.t('library.open')}
          </Link>
        </Button>
      ) : (
        <Button variant="secondary" loading={adding} onClick={() => void add()}>
          {adding ? m.t('library.adding') : m.t('library.add')}
        </Button>
      )}
    </Card>
  );
}

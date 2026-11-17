// The band overview: every frequency band with its progress (M5).
import type { WordBand } from '@app/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { apiQuery } from '../../lib/api';
import { t } from '../../messages';
import { Card, EmptyState, ProgressRing } from '../../ui';
import { m } from './messages';
import { ErrorState, LoadingState } from './states';

export function WordsScreen() {
  const bands = useQuery(apiQuery('words.bands'));
  const profile = useQuery(apiQuery('profile.get'));

  return (
    <section className="px-gutter py-6">
      <h1 className="text-2xl font-semibold text-fg">{t('screens.words')}</h1>
      <p className="mt-1 text-base text-fg-muted">{m.t('overview.intro')}</p>
      {profile.data && (
        <p className="mt-1 text-sm text-fg-muted">
          {m.t('overview.target', { count: profile.data.wordsBandTarget })}
        </p>
      )}
      <div className="mt-5">
        {bands.isPending ? (
          <LoadingState />
        ) : bands.isError ? (
          <ErrorState error={bands.error} onRetry={() => void bands.refetch()} />
        ) : bands.data.bands.length === 0 ? (
          <EmptyState title={m.t('overview.empty')} description={m.t('overview.emptyHint')} />
        ) : (
          <ul className="space-y-3">
            {bands.data.bands.map((b) => (
              <li key={b.band}>
                <BandCard band={b} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function BandCard({ band: b }: { band: WordBand }) {
  const range = { from: b.fromRank, to: b.toRank };
  const knownShare = b.total > 0 ? Math.round((b.known / b.total) * 100) : 0;
  return (
    <Card asChild>
      <Link
        to="/words/band/$band"
        params={{ band: String(b.band) }}
        className="flex items-center gap-4"
        data-band={b.band}
      >
        <ProgressRing
          value={b.known}
          max={b.total}
          label={m.t('overview.progressLabel', range)}
          valueText={`${b.known} / ${b.total}`}
          size={56}
        >
          {`${knownShare}%`}
        </ProgressRing>
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-semibold text-fg">
            {m.t('overview.bandTitle', range)}
          </span>
          <span className="block text-sm text-fg-muted">
            {m.t('overview.counts', { known: b.known, learning: b.learning, unknown: b.unknown })}
          </span>
        </span>
        <span aria-hidden="true" className="text-fg-muted">
          ›
        </span>
      </Link>
    </Card>
  );
}

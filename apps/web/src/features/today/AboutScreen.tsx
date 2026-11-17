// /settings/about: app version, server and content version (`GET /health`) and the sources.
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { apiQuery } from '../../lib/api';
import { t } from '../../messages';
import { Card, Skeleton } from '../../ui';
import { m, SOURCES } from './messages';

/** Set at build time (`VITE_APP_VERSION`); the shell defines none yet. */
export function appVersion(env: Record<string, unknown> = import.meta.env): string | null {
  const v = env.VITE_APP_VERSION;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function AboutScreen() {
  const health = useQuery(apiQuery('system.health'));
  const version = appVersion();
  const pending = (
    <span aria-hidden="true" className="inline-block w-24 align-middle">
      <Skeleton />
    </span>
  );
  const fromHealth = (v: string | null | undefined, missing: string) =>
    health.isPending ? pending : health.isError ? m.t('about.unknown') : (v ?? missing);

  return (
    <section className="flex flex-col gap-4 px-gutter py-6">
      <header className="flex flex-col gap-1">
        <Link
          to="/settings"
          className="inline-flex min-h-tap items-center self-start font-medium text-primary underline"
        >
          {m.t('about.back')}
        </Link>
        <h1 className="text-2xl font-semibold text-fg">{t('screens.about')}</h1>
      </header>

      <Card>
        <dl
          className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base"
          aria-busy={health.isPending}
        >
          <dt className="text-fg-muted">{m.t('about.appVersion')}</dt>
          <dd className="text-right text-fg" data-version="app">
            {version ?? m.t('about.unknown')}
          </dd>
          <dt className="text-fg-muted">{m.t('about.serverVersion')}</dt>
          <dd className="text-right text-fg" data-version="server">
            {fromHealth(health.data?.version, m.t('about.unknown'))}
          </dd>
          <dt className="text-fg-muted">{m.t('about.contentVersion')}</dt>
          <dd className="text-right text-fg" data-version="content">
            {fromHealth(health.data?.contentVersion, m.t('about.contentMissing'))}
          </dd>
        </dl>
        {health.isError && <p className="mt-2 text-sm text-fg-muted">{m.t('about.offline')}</p>}
      </Card>

      <Card title={m.t('about.sourcesTitle')} subtitle={m.t('about.sourcesIntro')}>
        <ul className="flex flex-col gap-3">
          {SOURCES.map((s) => (
            <li key={s.name} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
              <p className="font-medium text-fg">{s.name}</p>
              <p className="text-sm text-fg-muted">{s.usedFor}</p>
              <p className="text-sm text-fg-muted">
                {m.t('about.licence', { licence: s.licence })}
              </p>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

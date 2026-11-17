import type { ReactNode } from 'react';
import { t } from '../messages';

/**
 * The stand in screen of Phase 0. Each feature replaces its placeholders with real screens;
 * the route table and the export names stay the same.
 */
export function Placeholder({
  title,
  params,
  children,
}: {
  title: string;
  params?: Record<string, string>;
  children?: ReactNode;
}) {
  return (
    <section className="px-gutter py-6" data-placeholder={title}>
      <h1 className="text-2xl font-semibold text-fg">{title}</h1>
      <p className="mt-2 text-base text-fg-muted">{t('placeholder.note')}</p>
      {params && (
        <ul className="mt-3 text-sm text-fg-muted">
          {Object.entries(params).map(([name, value]) => (
            <li key={name}>{t('placeholder.param', { name, value })}</li>
          ))}
        </ul>
      )}
      {children}
    </section>
  );
}

import { Link, useLocation } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { t } from '../messages';
import { cn } from '../ui/cn';

export type TabId = 'today' | 'review' | 'read' | 'cases' | 'tutor';

/** Which tab a path belongs to (docs/architecture.md, "Screens"); null for screens without one. */
export function tabFor(pathname: string): TabId | null {
  const p = pathname.replace(/\/+$/, '') || '/';
  const first = p.split('/')[1] ?? '';
  if (p === '/' || first === 'settings') return 'today';
  if (['review', 'deck', 'words', 'lemma'].includes(first)) return 'review';
  if (first === 'read') return 'read';
  if (first === 'cases') return 'cases';
  if (first === 'tutor') return 'tutor';
  return null;
}

const icon = (d: string): ReactNode => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="size-6"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);

const TABS = [
  { id: 'today', to: '/', icon: icon('M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z') },
  { id: 'review', to: '/review', icon: icon('M4 6h12v14H4zM8 2h12v14') },
  {
    id: 'read',
    to: '/read',
    icon: icon(
      'M2 5h7a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H2zM22 5h-7a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h8z',
    ),
  },
  { id: 'cases', to: '/cases', icon: icon('M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z') },
  { id: 'tutor', to: '/tutor', icon: icon('M4 5h16v11H9l-5 4z') },
] as const;

/** The bottom tab bar of the five tabs. Sits above the home indicator (safe area). */
export function TabBar() {
  const { pathname } = useLocation();
  const active = tabFor(pathname);
  return (
    <nav
      aria-label={t('tabs.label')}
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface pb-safe px-safe"
    >
      <ul className="mx-auto flex max-w-xl">
        {TABS.map((tab) => {
          const current = tab.id === active;
          return (
            <li key={tab.id} className="flex-1">
              <Link
                to={tab.to}
                aria-current={current ? 'page' : undefined}
                data-tab={tab.id}
                className={cn(
                  'flex min-h-tap flex-col items-center justify-center gap-0.5 py-1.5 text-xs font-medium',
                  current ? 'text-primary' : 'text-fg-muted',
                )}
              >
                {tab.icon}
                <span>{t(`tabs.${tab.id}`)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

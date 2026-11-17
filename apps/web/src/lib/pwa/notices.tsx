// The notices above every tab screen (src/app/layouts.tsx): offline, a new version, a local
// database the browser refuses, and writes the server refused. Imported by file, not through
// lib/pwa/index.ts, so the hooks stay usable without React components. The first two moved
// here from features/today/AppNotices.tsx (M1); the last two are I4's.
import { useEffect, useState } from 'react';
import { type en, t } from '../../messages';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { outbox as appOutbox, type Outbox, type OutboxRow, useOutbox } from '../db';
import { useLocalDatabase } from '../db/storage';
import { useOnline, useUpdatePrompt } from './index';

export function OfflineIndicator() {
  const online = useOnline();
  if (online) return null;
  return (
    <p
      role="status"
      data-offline=""
      className="rounded-card border border-border-strong bg-surface-2 px-3 py-2 text-sm text-fg"
    >
      {t('notices.offline')}
    </p>
  );
}

export function UpdatePrompt() {
  const { needRefresh, update, dismiss } = useUpdatePrompt();
  if (!needRefresh) return null;
  return (
    <Card
      title={t('notices.updateTitle')}
      subtitle={t('notices.updateBody')}
      role="region"
      aria-label={t('notices.updateTitle')}
    >
      <div className="flex gap-2">
        <Button onClick={() => void update()}>{t('notices.updateAction')}</Button>
        <Button variant="ghost" onClick={dismiss}>
          {t('notices.updateLater')}
        </Button>
      </div>
    </Card>
  );
}

/** Shown when IndexedDB is missing or refuses to open (private mode, blocked site data). */
export function StorageNotice() {
  const state = useLocalDatabase();
  if (state !== 'unavailable') return null;
  return (
    <p
      role="alert"
      data-storage-unavailable=""
      className="rounded-card border border-danger bg-surface-2 px-3 py-2 text-sm text-fg"
    >
      {t('notices.storageUnavailable')}
    </p>
  );
}

const ITEM_LABELS: Partial<Record<string, keyof typeof en.syncItems>> = {
  'review.submitAnswers': 'reviewAnswers',
  'declension.submitAttempts': 'trainerAnswers',
  'declension.saveProgress': 'lessonProgress',
  'words.triage': 'sortedWords',
  'lemmas.setStatus': 'wordStatus',
  'notes.create': 'savedWord',
  'reports.create': 'report',
  'texts.update': 'readingPosition',
};

function itemLabel(row: OutboxRow): string {
  return t(`syncItems.${ITEM_LABELS[row.name] ?? 'other'}`);
}

/** How many answers or decisions one batch item holds, for its label. */
function itemCount(row: OutboxRow): number | null {
  const body = (row.input as { body?: Record<string, unknown> }).body;
  for (const key of ['answers', 'attempts', 'decisions']) {
    const v = body?.[key];
    if (Array.isArray(v)) return v.length;
  }
  return null;
}

/**
 * Writes the server refused for good (a 4xx): each with its reason, a retry and a discard.
 * Nothing else blocks on them; later writes go on.
 */
export function SyncIssues({ target = appOutbox }: { target?: Outbox }) {
  const { failed, lastSyncAt } = useOutbox(target);
  const [rows, setRows] = useState<OutboxRow[]>([]);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    if (failed === 0) {
      setRows([]);
      return;
    }
    target.failedItems().then(
      (r) => {
        if (live) setRows(r);
      },
      () => {},
    );
    return () => {
      live = false;
    };
    // lastSyncAt: a retry that failed again keeps the count but changes the reason.
  }, [failed, lastSyncAt, target]);

  if (rows.length === 0) return null;
  const act = async (seq: number, f: (seq: number) => Promise<unknown>) => {
    setBusy(seq);
    try {
      await f(seq);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card
      title={t('notices.syncTitle')}
      subtitle={t('notices.syncBody')}
      role="region"
      aria-label={t('notices.syncTitle')}
      data-sync-issues=""
    >
      <ul className="flex flex-col gap-3">
        {rows.map((row) => {
          const seq = row.seq as number;
          const count = itemCount(row);
          const label = count === null ? itemLabel(row) : `${itemLabel(row)} (${count})`;
          return (
            <li key={seq} data-sync-item={row.name} className="flex flex-col gap-2">
              <p className="text-sm font-medium">{label}</p>
              {row.lastError && (
                <p className="text-sm text-fg-muted">
                  {t('notices.syncReason', { message: row.lastError.message })}
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  loading={busy === seq}
                  aria-label={`${t('notices.syncRetry')}: ${label}`}
                  onClick={() => void act(seq, (s) => target.retry(s))}
                >
                  {t('notices.syncRetry')}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy === seq}
                  aria-label={`${t('notices.syncDiscard')}: ${label}`}
                  onClick={() => void act(seq, (s) => target.discard(s))}
                >
                  {t('notices.syncDiscard')}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Every notice in a column; renders nothing (and takes no room) when none shows. */
export function PwaNotices({ className }: { className?: string }) {
  return (
    <div className={`flex flex-col gap-3 empty:hidden ${className ?? ''}`}>
      <StorageNotice />
      <OfflineIndicator />
      <SyncIssues />
      <UpdatePrompt />
    </div>
  );
}

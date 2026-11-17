import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { en } from '../../messages';
import { mockEndpoint, renderWithProviders, server, testOutbox } from '../../test/utils';
import { checkLocalDatabase, resetLocalDatabaseCheck } from '../db/storage';
import { StorageNotice, SyncIssues } from './notices';

describe('sync problems notice', () => {
  it('lists a refused write with its reason, retries it, and discards it', async () => {
    const refuse = true;
    let calls = 0;
    server.use(
      mockEndpoint('lemmas.setStatus', ({ params, body }) => {
        calls++;
        if (refuse) {
          return HttpResponse.json(
            { error: { code: 'not_found', message: 'No such word.' } },
            { status: 404 },
          );
        }
        return { lemmaId: Number(params.id), status: body.status };
      }),
    );
    const box = testOutbox();
    await box.enqueue('lemmas.setStatus', { params: { id: 7 }, body: { status: 'known' } });
    await box.flush();
    expect(box.getState().failed).toBe(1);

    const user = userEvent.setup();
    renderWithProviders(<SyncIssues target={box} />);
    const region = await screen.findByRole('region', { name: en.notices.syncTitle });
    expect(region).toHaveTextContent('Word status');
    expect(region).toHaveTextContent('The server said: No such word.');

    // A retry that is refused again keeps the item.
    await user.click(screen.getByRole('button', { name: 'Try again: Word status' }));
    await waitFor(() => expect(calls).toBe(2));
    expect(await screen.findByRole('region', { name: en.notices.syncTitle })).toBeVisible();

    // Discard removes it; the notice goes.
    await user.click(screen.getByRole('button', { name: 'Discard: Word status' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: en.notices.syncTitle })).toBeNull(),
    );
    expect(await box.list()).toEqual([]);
    box.db.close();
  });

  it('a retry that goes through clears the notice', async () => {
    let refuse = true;
    server.use(
      mockEndpoint('words.triage', ({ body }) => {
        if (refuse) {
          return HttpResponse.json(
            { error: { code: 'validation_failed', message: 'Bad batch.' } },
            { status: 400 },
          );
        }
        return { updated: body.decisions.length, notesCreated: 0 };
      }),
    );
    const box = testOutbox();
    await box.enqueue('words.triage', {
      body: {
        decisions: [
          { lemmaId: 1, decision: 'known' },
          { lemmaId: 2, decision: 'learn' },
        ],
      },
    });
    await box.flush();
    const user = userEvent.setup();
    renderWithProviders(<SyncIssues target={box} />);
    expect(await screen.findByText('Sorted words (2)')).toBeVisible();
    refuse = false;
    await user.click(screen.getByRole('button', { name: 'Try again: Sorted words (2)' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: en.notices.syncTitle })).toBeNull(),
    );
    await waitFor(async () => expect(await box.list()).toEqual([]));
    box.db.close();
  });
});

describe('local database notice', () => {
  afterEach(() => resetLocalDatabaseCheck());

  it('says so when the browser refuses the local database', async () => {
    const { db } = await import('../db/db');
    const open = db.open.bind(db);
    db.open = () => Promise.reject(new Error('blocked')) as never;
    try {
      resetLocalDatabaseCheck();
      renderWithProviders(<StorageNotice />);
      expect(await screen.findByRole('alert')).toHaveTextContent(en.notices.storageUnavailable);
    } finally {
      db.open = open;
    }
  });

  it('shows nothing when the database opens', async () => {
    resetLocalDatabaseCheck();
    renderWithProviders(<StorageNotice />);
    await checkLocalDatabase();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

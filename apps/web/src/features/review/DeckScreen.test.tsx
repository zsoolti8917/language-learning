import {
  EXAMPLE_IDS,
  examples,
  type NoteDetail,
  type NoteSummary,
  type UpdateNote,
} from '@app/contracts';

type NoteList = { items: NoteSummary[]; nextCursor: string | null };

/** The first screen of a test loads the lazy route and the data. */
const SLOW = { timeout: 5000 };

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearLocalData, db, replaceReviewQueue } from '../../lib/db';
import { mockEndpoint, mockError, renderRoute, server } from '../../test/utils';
import { mockQueue } from './mocks';
import { editedContent } from './NoteEditSheet';

const DETAIL = examples['notes.get'].ok[0]?.response.body as NoteDetail;

beforeEach(async () => {
  await clearLocalData(db);
});

describe('DeckScreen', () => {
  it('lists notes, filters by kind and searches', async () => {
    const queries: Record<string, string>[] = [];
    server.use(
      mockEndpoint('notes.list', ({ query }) => {
        queries.push(Object.fromEntries(query));
        const all = [
          {
            id: EXAMPLE_IDS.noteMesto,
            kind: 'word' as const,
            label: 'mesto',
            glossEn: 'town, city',
            lemmaId: 20,
            source: 'reader' as const,
            suspended: false,
            state: 'review' as const,
            dueAt: '2026-11-18T08:30:00.000Z',
            createdAt: '2026-11-01T10:00:00.000Z',
          },
          {
            id: EXAMPLE_IDS.noteCase,
            kind: 'case_sentence' as const,
            label: 'kino',
            glossEn: null,
            lemmaId: 21,
            source: 'declension' as const,
            suspended: true,
            state: 'new' as const,
            dueAt: null,
            createdAt: '2026-11-01T10:00:00.000Z',
          },
        ];
        const kind = query.get('kind');
        const q = query.get('q');
        const items = all.filter((n) => (!kind || n.kind === kind) && (!q || n.label.includes(q)));
        return { items, nextCursor: null };
      }),
    );
    const user = userEvent.setup();
    renderRoute('/deck');
    expect(
      await screen.findByRole('heading', { name: 'Deck', level: 1 }, SLOW),
    ).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Deck' }, SLOW);
    expect(within(list).getAllByRole('link')).toHaveLength(2);
    expect(within(list).getByText('Suspended')).toBeInTheDocument();
    expect(within(list).getByRole('link', { name: /mesto/ })).toHaveAttribute(
      'href',
      `/deck/${EXAMPLE_IDS.noteMesto}`,
    );

    await user.click(screen.getByRole('button', { name: 'Case sentence' }));
    expect(screen.getByRole('button', { name: 'Case sentence' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await waitFor(() =>
      expect(within(screen.getByRole('list', { name: 'Deck' })).getAllByRole('link')).toHaveLength(
        1,
      ),
    );
    expect(queries.at(-1)).toMatchObject({ kind: 'case_sentence', limit: '50' });

    await user.click(screen.getByRole('button', { name: 'All' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search notes' }), 'zzz');
    expect(await screen.findByText('No notes match this search.')).toBeInTheDocument();
    expect(queries.at(-1)).toMatchObject({ q: 'zzz' });
  });

  it('loads more pages', async () => {
    const first = examples['notes.list'].ok[0]?.response.body as NoteList | undefined;
    const row = first?.items[0];
    if (!first || !row) throw new Error('no example');
    server.use(
      mockEndpoint('notes.list', ({ query }) =>
        query.get('cursor')
          ? {
              items: [
                {
                  ...row,
                  id: EXAMPLE_IDS.notePhrase,
                  label: 'do kina',
                  kind: 'phrase' as const,
                },
              ],
              nextCursor: null,
            }
          : first,
      ),
    );
    const user = userEvent.setup();
    renderRoute('/deck');
    await user.click(await screen.findByRole('button', { name: 'Load more' }, SLOW));
    expect(await screen.findByText('do kina')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('shows the empty state and the error state', async () => {
    server.use(mockEndpoint('notes.list', { items: [], nextCursor: null }));
    const view = renderRoute('/deck');
    expect(await screen.findByText('No notes', {}, SLOW)).toBeInTheDocument();
    view.unmount();
    server.use(mockError('notes.list', 'internal'));
    renderRoute('/deck');
    expect(await screen.findByText('The deck did not load', {}, SLOW)).toBeInTheDocument();
  });
});

describe('NoteScreen', () => {
  const path = `/deck/${EXAMPLE_IDS.noteMesto}`;

  it('shows the sentences, the schedule and the last reviews', async () => {
    renderRoute(path);
    expect(await screen.findByTestId('note-label', {}, SLOW)).toHaveTextContent('mesto');
    expect(screen.getByRole('heading', { name: 'Note', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sentences' })).toBeInTheDocument();
    expect(screen.getByText('I live in a town.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Schedule' })).toBeInTheDocument();
    expect(screen.getByText('4.9 days')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Last reviews' })).toBeInTheDocument();
    expect(screen.getByText(/Rated Good/)).toBeInTheDocument();
    expect(DETAIL.reviews).toHaveLength(1);
  });

  it('suspends a note and takes its card out of the local queue', async () => {
    const bodies: UpdateNote[] = [];
    server.use(
      mockEndpoint('notes.update', ({ body }) => {
        bodies.push(body);
        return { ...DETAIL, note: { ...DETAIL.note, suspended: body.suspended ?? false } };
      }),
    );
    const q = mockQueue();
    const first = q.items[0];
    if (!first) throw new Error('empty mock queue');
    await replaceReviewQueue({ ...q, items: [{ ...first, noteId: EXAMPLE_IDS.noteMesto }] }, db);
    const user = userEvent.setup();
    renderRoute(path);
    await user.click(await screen.findByRole('button', { name: 'Suspend' }, SLOW));
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.getByText(/Suspended. This note stays out/)).toBeInTheDocument();
    expect(bodies).toEqual([{ suspended: true }]);
    expect(await db.reviewQueue.count()).toBe(0);
  });

  it('edits the meaning', async () => {
    const bodies: UpdateNote[] = [];
    server.use(
      mockEndpoint('notes.update', ({ body }) => {
        bodies.push(body);
        return {
          ...DETAIL,
          note: { ...DETAIL.note, content: body.content ?? DETAIL.note.content },
        };
      }),
    );
    const user = userEvent.setup();
    renderRoute(path);
    await user.click(await screen.findByRole('button', { name: 'Edit' }, SLOW));
    const dialog = await screen.findByRole('dialog', { name: 'Edit note' });
    const field = within(dialog).getByLabelText('Meaning in English');
    await user.clear(field);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('This field is needed.')).toBeInTheDocument();
    expect(bodies).toEqual([]);
    await user.type(field, 'town');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]?.content).toMatchObject({ kind: 'word', glossEn: 'town', lemma: 'mesto' });
    expect(await screen.findByText('town')).toBeInTheDocument();
  });

  it('deletes after asking, then returns to the deck', async () => {
    let deleted = 0;
    server.use(
      mockEndpoint('notes.delete', () => {
        deleted += 1;
        return new Response(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    const { router } = renderRoute(path);
    await user.click(await screen.findByRole('button', { name: 'Delete' }, SLOW));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this note?' });
    expect(deleted).toBe(0);
    await user.click(within(dialog).getByRole('button', { name: 'Delete note' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/deck'));
    expect(deleted).toBe(1);
  });

  it('says when the note does not exist', async () => {
    server.use(mockError('notes.get', 'not_found'));
    renderRoute(path);
    expect(await screen.findByText('This note does not exist.', {}, SLOW)).toBeInTheDocument();
  });
});

describe('editedContent', () => {
  it('splits answers and needs a cue', () => {
    const content = {
      kind: 'case_sentence' as const,
      sentenceSk: 'Idem do mesta.',
      sentenceEn: 'I am going to town.',
      blank: { start: 8, end: 13 },
      cue: 'mesto',
      answers: ['mesta'],
      features: { case: 'gen' as const, number: 'sg' as const },
    };
    expect(
      editedContent(content, { glossEn: '', sentenceEn: ' x ', cue: 'mesto', answers: 'mesta, ' }),
    ).toEqual({
      content: { ...content, sentenceEn: 'x' },
    });
    expect(editedContent(content, { glossEn: '', sentenceEn: '', cue: ' ', answers: '' })).toEqual({
      missing: ['cue', 'answers'],
    });
  });
});

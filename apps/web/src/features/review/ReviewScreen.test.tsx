import {
  type ReviewQueue,
  ReviewQueueSchema,
  type SubmitAnswers,
  SubmitAnswersResultSchema,
} from '@app/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api } from '../../lib/api';
import { clearLocalData, db, getReviewQueue, outbox, replaceReviewQueue } from '../../lib/db';
import { mockEndpoint, mockError, mockNetworkError, renderRoute, server } from '../../test/utils';
import { mockQueue, reviewMockHandlers } from './mocks';

/** The first screen of a test loads the lazy route, the profile and the queue. */
const SLOW = { timeout: 5000 };

function twoCards(): ReviewQueue {
  const q = mockQueue(new Date());
  // The review of "Idem do mesta." and the new card "Kúpim knihu.".
  const mesta = q.items.find((i) => i.answers[0] === 'mesta');
  const knihu = q.items.find((i) => i.answers[0] === 'knihu');
  if (!mesta || !knihu) throw new Error('mock queue changed');
  const fresh = { ...knihu, state: 'new' as const, dueAt: null, scheduler: null };
  return {
    ...q,
    items: [{ ...mesta, state: 'review' as const }, fresh],
    counts: { due: 1, new: 1, learning: 0 },
  };
}

async function waitingAnswers(): Promise<SubmitAnswers['answers']> {
  const rows = await outbox.list();
  return rows
    .filter((r) => r.name === 'review.submitAnswers')
    .flatMap((r) => (r.input as { body: SubmitAnswers }).body.answers);
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value });
}

beforeEach(async () => {
  await clearLocalData(db);
});
afterEach(() => {
  setOnline(true);
});

describe('ReviewScreen', () => {
  it('Enter submits the answer, Enter again accepts the default rating', async () => {
    server.use(mockEndpoint('review.queue', twoCards()));
    const user = userEvent.setup();
    renderRoute('/review');
    const field = await screen.findByLabelText('Your answer', {}, SLOW);
    expect(screen.getByTestId('prompt')).toHaveTextContent('Idem do');
    expect(screen.getByText('mesto')).toBeInTheDocument(); // the cue
    expect(screen.getByText('I am going to town.')).toBeInTheDocument();
    expect(screen.getByTestId('left')).toHaveTextContent('2 left');
    await waitFor(() => expect(field).toHaveFocus());

    await user.keyboard('mesta{Enter}');
    expect(await screen.findByText('Correct')).toBeInTheDocument();
    expect(screen.getByTestId('prompt')).toHaveTextContent('Idem do mesta.');
    const group = screen.getByRole('group', { name: 'How did it go?' });
    expect(within(group).getByRole('button', { name: 'Good' })).toHaveAttribute('data-default');
    expect(screen.getByText('Enter accepts Good.')).toBeInTheDocument();
    expect(field).toHaveFocus();

    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByTestId('prompt')).toHaveTextContent('Kúpim'));
    await waitFor(async () => expect(await waitingAnswers()).toHaveLength(1));
    const [a] = await waitingAnswers();
    expect(a).toMatchObject({
      typed: 'mesta',
      clientGrade: 'correct',
      rating: 3,
      overridden: false,
    });

    // The local queue holds the card's new state: due again in days, not now.
    const { items } = await getReviewQueue(db);
    const stored = items.find((i) => i.cardId === a?.cardId);
    expect(stored?.state).toBe('review');
    expect(Date.parse(stored?.dueAt ?? '')).toBeGreaterThan(Date.now() + 86_400_000);
  });

  it('wrong answer: names the case, the learner changes the rating', async () => {
    server.use(mockEndpoint('review.queue', twoCards()));
    const user = userEvent.setup();
    renderRoute('/review');
    await screen.findByLabelText('Your answer', {}, SLOW);
    await user.keyboard('meste{Enter}');
    expect(await screen.findByText('Wrong')).toBeInTheDocument();
    expect(screen.getByText(/meste is the locative singular/)).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'How did it go?' });
    expect(within(group).getByRole('button', { name: 'Again' })).toHaveAttribute('data-default');
    await user.click(within(group).getByRole('button', { name: 'Hard' }));
    await waitFor(async () => expect(await waitingAnswers()).toHaveLength(1));
    expect((await waitingAnswers())[0]).toMatchObject({
      clientGrade: 'wrong',
      rating: 2,
      overridden: true,
    });
  });

  it('show answer counts as revealed', async () => {
    server.use(mockEndpoint('review.queue', twoCards()));
    const user = userEvent.setup();
    renderRoute('/review');
    await screen.findByLabelText('Your answer', {}, SLOW);
    await user.click(screen.getByRole('button', { name: 'Show answer' }));
    expect(await screen.findByText('Shown')).toBeInTheDocument();
    expect(screen.getByText(/The answer is/)).toHaveTextContent('The answer is mesta.');
    await user.keyboard('{Enter}');
    await waitFor(async () => expect(await waitingAnswers()).toHaveLength(1));
    expect((await waitingAnswers())[0]).toMatchObject({ clientGrade: 'revealed', rating: 1 });
  });

  it('finishes the session and merges the answers into one batch', async () => {
    server.use(mockEndpoint('review.queue', twoCards()));
    const user = userEvent.setup();
    renderRoute('/review');
    await screen.findByLabelText('Your answer', {}, SLOW);
    await user.keyboard('mesta{Enter}{Enter}');
    await waitFor(() => expect(screen.getByTestId('prompt')).toHaveTextContent('Kúpim'));
    await user.keyboard('knihu{Enter}');
    await user.click(screen.getByRole('button', { name: 'Easy' }));
    expect(await screen.findByText('Done for now')).toBeInTheDocument();
    expect(screen.getByText('You answered 2 cards, 2 of them right.')).toBeInTheDocument();
    await waitFor(async () => expect(await waitingAnswers()).toHaveLength(2));
    expect(await outbox.list()).toHaveLength(1);
  });

  it('sends waiting answers before it fetches a new queue', async () => {
    const sent: number[] = [];
    server.use(
      mockEndpoint('review.queue', twoCards()),
      mockEndpoint('review.submitAnswers', ({ body }) => {
        sent.push(body.answers.length);
        return {
          results: body.answers.map((a) => ({
            id: a.id,
            cardId: a.cardId,
            grade: a.clientGrade,
            rating: a.rating,
            card: {
              cardId: a.cardId,
              state: 'review' as const,
              dueAt: '2030-01-01T00:00:00.000Z',
              stability: 10,
              difficulty: 5,
              reps: 3,
              lapses: 0,
              scheduler: null,
            },
          })),
          counts: { due: 0, new: 0, learning: 0 },
        };
      }),
    );
    const user = userEvent.setup();
    const first = renderRoute('/review');
    await screen.findByLabelText('Your answer', {}, SLOW);
    await user.keyboard('mesta{Enter}{Enter}');
    await waitFor(async () => expect(await waitingAnswers()).toHaveLength(1));
    first.unmount();

    renderRoute('/review');
    await screen.findByLabelText('Your answer', {}, SLOW);
    expect(sent).toEqual([1]);
    expect(await outbox.list()).toHaveLength(0);
  });

  it('offline: uses the stored queue without the cards already answered', async () => {
    const q = twoCards();
    await replaceReviewQueue(q, db);
    setOnline(false);
    const user = userEvent.setup();
    const first = renderRoute('/review');
    await screen.findByLabelText('Your answer', {}, SLOW);
    expect(screen.getByText(/Offline/)).toBeInTheDocument();
    await user.keyboard('mesta{Enter}{Enter}');
    await waitFor(() => expect(screen.getByTestId('prompt')).toHaveTextContent('Kúpim'));
    await waitFor(async () => expect(await waitingAnswers()).toHaveLength(1));
    expect(await screen.findByText(/waiting to be sent/)).toBeInTheDocument();
    first.unmount();

    // Reopened offline: only the new card is left; the answered review is due in days.
    renderRoute('/review');
    await screen.findByLabelText('Your answer', {}, SLOW);
    expect(screen.getByTestId('prompt')).toHaveTextContent('Kúpim');
    expect(screen.getByTestId('left')).toHaveTextContent('1 left');
  });

  it('offline on a device without a stored queue', async () => {
    setOnline(false);
    renderRoute('/review');
    expect(await screen.findByText('You are offline', {}, SLOW)).toBeInTheDocument();
  });

  it('network failure falls back to the stored queue', async () => {
    await replaceReviewQueue(twoCards(), db);
    server.use(mockNetworkError('review.queue'));
    renderRoute('/review');
    expect(await screen.findByLabelText('Your answer', {}, SLOW)).toBeInTheDocument();
  });

  it('shows an error with a retry when the queue fails to load', async () => {
    server.use(mockError('review.queue', 'internal', { once: true }));
    const user = userEvent.setup();
    renderRoute('/review');
    expect(await screen.findByText('The review queue did not load', {}, SLOW)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Your answer', {}, SLOW)).toBeInTheDocument();
  });

  it('shows the empty state when nothing is due', async () => {
    server.use(
      mockEndpoint('review.queue', {
        items: [],
        counts: { due: 0, new: 0, learning: 0 },
        serverTime: new Date().toISOString(),
      }),
    );
    renderRoute('/review');
    expect(await screen.findByText('Nothing to review', {}, SLOW)).toBeInTheDocument();
  });

  it('reports a card through the outbox', async () => {
    server.use(mockEndpoint('review.queue', twoCards()));
    const user = userEvent.setup();
    renderRoute('/review');
    await screen.findByLabelText('Your answer', {}, SLOW);
    await user.click(screen.getByRole('button', { name: 'Report a problem' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('What is wrong?'), 'Odd translation');
    await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
    expect(
      await screen.findByText('Thanks. The report is saved and will be sent.'),
    ).toBeInTheDocument();
    const rows = await outbox.list();
    const report = rows.find((r) => r.name === 'reports.create');
    expect(report?.input).toMatchObject({
      body: {
        targetKind: 'sentence',
        targetRef: `note:${twoCards().items[0]?.noteId}/0`,
        comment: 'Odd translation',
      },
    });
  });
});

describe('mock queue', () => {
  it('has due reviews and new cards that the scheduler can read', () => {
    const q = mockQueue(new Date('2026-11-17T08:30:00.000Z'));
    expect(q.items.length).toBeGreaterThanOrEqual(5);
    expect(q.counts.due + q.counts.new).toBe(q.items.length);
    for (const i of q.items) {
      expect(i.prompt.sentenceSk.slice(i.prompt.blank.start, i.prompt.blank.end)).toBe(
        i.answers[0],
      );
      if (i.state === 'review')
        expect(Date.parse(i.dueAt ?? '')).toBeLessThan(Date.parse(q.serverTime));
    }
  });
});

describe('review mock handlers', () => {
  it('answer with a contract valid queue and a card state per answer', async () => {
    server.use(...reviewMockHandlers);
    const queue = ReviewQueueSchema.parse(await api.review.queue({ query: { limit: 50 } }));
    const [first, second] = queue.items;
    if (!first || !second) throw new Error('short queue');
    const answer = {
      cardId: first.cardId,
      answeredAt: new Date().toISOString(),
      typed: 'x',
      variant: 0,
      clientGrade: 'wrong' as const,
      rating: 1 as const,
      overridden: false,
      durationMs: 1000,
    };
    const res = SubmitAnswersResultSchema.parse(
      await api.review.submitAnswers({
        body: {
          clientId: 'web-test',
          answers: [
            { ...answer, id: '0193a1b2-c3d4-7e5f-8a6b-00000000f001' },
            { ...answer, id: '0193a1b2-c3d4-7e5f-8a6b-00000000f002', cardId: second.cardId },
          ],
        },
      }),
    );
    expect(res.results.map((r) => [r.cardId, r.card.state])).toEqual([
      [first.cardId, 'learning'],
      [second.cardId, 'learning'],
    ]);
  });
});

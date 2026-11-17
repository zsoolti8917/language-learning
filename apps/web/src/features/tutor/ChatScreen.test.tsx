import {
  type ConversationDetail,
  EXAMPLE_IDS,
  examples,
  type TutorStreamEvent,
} from '@app/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { en } from '../../messages';
import { mockEndpoint, mockError, renderRoute, server } from '../../test/utils';
import { m } from './messages';
import { MOCK_END_SUMMARY, MOCK_IDS } from './mocks';

const CONV = EXAMPLE_IDS.conversation;
const URL = `/tutor/${CONV}`;
const FRESH = examples['tutor.startConversation'].ok[0]?.response.body as ConversationDetail;
const EXISTING = examples['tutor.getConversation'].ok[0]?.response.body as ConversationDetail;

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

afterEach(() => setOnline(true));

async function openChat(detail: ConversationDetail = FRESH) {
  server.use(mockEndpoint('tutor.getConversation', detail));
  const user = userEvent.setup();
  const view = renderRoute(URL);
  await screen.findByRole('heading', { name: en.screens.chat, level: 1 });
  await screen.findByRole('list', { name: m.t('chat.messagesLabel') });
  return { user, ...view };
}

async function type(user: ReturnType<typeof userEvent.setup>, text: string) {
  const field = screen.getByRole('textbox', { name: m.t('composer.label') });
  await user.clear(field);
  await user.type(field, text);
  await user.click(screen.getByRole('button', { name: m.t('composer.send') }));
}

const list = () => screen.getByRole('list', { name: m.t('chat.messagesLabel') });

/** Waits for a tutor reply to be settled by `done` (the deltas show the text earlier). */
async function settled(text: string) {
  const reply = await within(list()).findByText(text);
  await waitFor(() => expect(reply.closest('li')?.dataset.state).toBe('sent'));
  return reply;
}

describe('chat screen', () => {
  it('shows the scenario, its goal with ticks, and the opening message', async () => {
    await openChat(EXISTING);
    expect(screen.getByText(/A walk in town/)).toBeInTheDocument();
    const goal = screen.getByRole('list', { name: m.t('chat.goalLabel') });
    const items = within(goal).getAllByRole('listitem');
    expect(items.map((li) => li.dataset.met)).toEqual(['true', 'false']);
    expect(items[0]).toHaveTextContent(m.t('chat.criterionMet'));
    expect(within(list()).getByText('Ideš dnes do mesta?')).toBeInTheDocument();
  });

  it('marks a stored error in the learner message, without the answer', async () => {
    const { container } = await openChat(EXISTING);
    const mark = container.querySelector(`[data-error-id="${EXAMPLE_IDS.tutorError}"][data-mark]`);
    expect(mark).toHaveTextContent(/^kamarát$/);
    expect(mark?.getAttribute('data-mark')).toBe('prompted');
    expect(screen.getByText(m.t('marks.prompted', { given: 'kamarát' }))).toBeInTheDocument();
    expect(screen.queryByText(/kamarátom/)).toBeNull();
  });

  it('streams a turn: underline, growing reply, settled reply with a goal tick', async () => {
    const { user, container } = await openChat();
    await type(user, 'Dnes idem do kina s kamarát.');
    const reply = await settled('S kým ideš do kina?');
    expect(reply.closest('li')?.dataset.state).toBe('sent');
    const mark = container.querySelector('[data-mark="prompted"]');
    expect(mark).toHaveTextContent(/^kamarát$/);
    expect(mark?.parentElement).toHaveTextContent(m.t('marks.srPrompted'));
    // Sending again is possible once the turn is over.
    expect(screen.getByRole('textbox', { name: m.t('composer.label') })).toHaveValue('');
  });

  it('shows the learner fixing one error, the tutor correcting another, and a card chip', async () => {
    const { user, container } = await openChat();
    await type(user, 'Dnes idem do kina s kamarát.');
    await settled('S kým ideš do kina?');

    await type(user, 'Idem s kamarátom. Potom ideme do mesto.');
    await settled('Výborne, s kamarátom! A kam idete potom?');
    expect(
      container
        .querySelector(`[data-error-id="${MOCK_IDS.errorKamarat}"][data-mark]`)
        ?.getAttribute('data-mark'),
    ).toBe('self_corrected');
    expect(screen.getByText(m.t('marks.selfCorrected', { given: 'kamarát' }))).toBeInTheDocument();
    const goal = screen.getByRole('list', { name: m.t('chat.goalLabel') });
    expect(
      within(goal)
        .getAllByRole('listitem')
        .map((li) => li.dataset.met),
    ).toEqual(['true', 'true']);

    await type(user, 'Do mesto.');
    await settled('Aha, idete do mesta. Čo tam budete robiť?');
    expect(
      screen.getByText(m.t('marks.corrected', { given: 'mesto', expected: 'mesta' })),
    ).toBeInTheDocument();
    expect(screen.getByText('After do, use the genitive: do mesta.')).toBeInTheDocument();
    const chip = screen.getByRole('link', { name: new RegExp(m.t('chat.cardAdded')) });
    expect(chip).toHaveAttribute('href', `/deck/${MOCK_IDS.noteMesta}`);
  });

  it('peeks a hint and the answer for an open error, and translates a tutor message', async () => {
    let peekBody: unknown;
    server.use(
      mockEndpoint('tutor.peek', ({ body }) => {
        peekBody = body;
        return {
          text: body.kind === 'translate' ? 'Are you going to town today?' : `peek:${body.kind}`,
        };
      }),
    );
    const { user } = await openChat(EXISTING);
    await user.click(screen.getByRole('button', { name: m.t('marks.hint') }));
    expect(await screen.findByText('peek:hint')).toBeInTheDocument();
    expect(peekBody).toEqual({ kind: 'hint', errorId: EXAMPLE_IDS.tutorError });
    await user.click(screen.getByRole('button', { name: m.t('marks.answer') }));
    expect(await screen.findByText('peek:answer')).toBeInTheDocument();

    await user.click(
      screen.getAllByRole('button', { name: m.t('chat.translate') })[0] as HTMLElement,
    );
    expect(await screen.findByText('Are you going to town today?')).toBeInTheDocument();
    expect(peekBody).toEqual({ kind: 'translate', messageId: EXAMPLE_IDS.tutorMessage0 });
  });

  it('files a dispute on a correction and shows it as reported', async () => {
    let disputed: { id?: string; body?: unknown } = {};
    server.use(
      mockEndpoint('tutor.disputeError', ({ params, body }) => {
        disputed = { id: params.id, body };
        return { id: params.id as string, status: 'disputed' as const };
      }),
    );
    const corrected: ConversationDetail = {
      ...EXISTING,
      errors: [
        {
          ...(EXISTING.errors[0] as ConversationDetail['errors'][number]),
          status: 'corrected',
          expected: 'kamarátom',
          explanationEn: 'After s, use the instrumental.',
        },
      ],
    };
    const { user, container } = await openChat(corrected);
    await user.click(screen.getByRole('button', { name: m.t('marks.looksWrong') }));
    const sheet = await screen.findByRole('dialog', { name: m.t('dispute.title') });
    await user.type(
      within(sheet).getByRole('textbox', { name: m.t('dispute.comment') }),
      'Myslím, že je to správne.',
    );
    await user.click(within(sheet).getByRole('button', { name: m.t('dispute.submit') }));
    await waitFor(() => expect(container.querySelector('[data-mark="disputed"]')).not.toBeNull());
    expect(disputed).toEqual({
      id: EXAMPLE_IDS.tutorError,
      body: { comment: 'Myslím, že je to správne.' },
    });
    expect(screen.getByText(m.t('marks.disputed', { given: 'kamarát' }))).toBeInTheDocument();
  });

  it('offers a retry after an error and stores the message once', async () => {
    const clientIds: string[] = [];
    server.use(
      mockEndpoint('tutor.sendMessage', ({ body }) => {
        clientIds.push(body.clientId);
        return clientIds.length === 1
          ? ([
              { event: 'error', data: { code: 'upstream_failed', message: 'x' } },
            ] as TutorStreamEvent[])
          : ([
              { event: 'analysis', data: { messageId: body.clientId, errors: [], resolved: [] } },
              { event: 'delta', data: { text: 'Dobre.' } },
              {
                event: 'done',
                data: {
                  tutorMessage: { id: EXAMPLE_IDS.tutorMessage2, seq: 2, content: 'Dobre.' },
                  cardsCreated: [],
                  goal: { criteriaMet: [] },
                  budget: { remainingUsd: 0.5 },
                },
              },
            ] as TutorStreamEvent[]);
      }),
    );
    const { user } = await openChat();
    await type(user, 'Ahoj, ako sa máš?');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(m.t('turn.failed'));
    expect(screen.getByRole('button', { name: m.t('composer.send') })).toBeDisabled();
    await user.click(within(alert).getByRole('button', { name: m.t('turn.retry') }));
    await settled('Dobre.');
    expect(clientIds).toHaveLength(2);
    expect(clientIds[1]).toBe(clientIds[0]);
    expect(within(list()).getAllByText('Ahoj, ako sa máš?')).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('switches the composer off when the daily budget is used up', async () => {
    server.use(mockError('tutor.sendMessage', 'budget_exceeded'));
    const { user } = await openChat();
    await type(user, 'Ahoj');
    expect(await screen.findByText(m.t('composer.budget'))).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: m.t('composer.label') })).toBeDisabled();
    expect(screen.queryByRole('button', { name: m.t('turn.retry') })).toBeNull();
  });

  it('switches the composer off without a connection and keeps the typed text', async () => {
    const { user } = await openChat();
    await user.type(screen.getByRole('textbox', { name: m.t('composer.label') }), 'Ahoj');
    act(() => setOnline(false));
    expect(await screen.findByText(m.t('composer.offline'))).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: m.t('composer.label') })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: m.t('composer.label') })).toHaveValue('Ahoj');
    expect(screen.getByRole('button', { name: m.t('composer.send') })).toBeDisabled();
    act(() => setOnline(true));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: m.t('composer.send') })).toBeEnabled(),
    );
  });

  it('shows model output as plain text, never as HTML', async () => {
    server.use(
      mockEndpoint('tutor.sendMessage', ({ body }) => [
        { event: 'analysis', data: { messageId: body.clientId, errors: [], resolved: [] } },
        {
          event: 'done',
          data: {
            tutorMessage: { id: EXAMPLE_IDS.tutorMessage2, seq: 2, content: '<b>Ahoj</b> **ty**' },
            cardsCreated: [],
            goal: { criteriaMet: [] },
            budget: { remainingUsd: 0.5 },
          },
        },
      ]),
    );
    const { user, container } = await openChat();
    await type(user, 'Ahoj');
    expect(await within(list()).findByText('<b>Ahoj</b> **ty**')).toBeInTheDocument();
    expect(container.querySelector('[data-chat-list] b')).toBeNull();
  });

  it('limits the message to the character limit and shows a counter near it', async () => {
    const { user } = await openChat();
    const field = screen.getByRole('textbox', { name: m.t('composer.label') });
    expect(field).toHaveAttribute('maxlength', '1000');
    expect(field).toHaveAttribute('lang', 'sk');
    await user.click(field);
    await user.paste('a'.repeat(950));
    expect(screen.getByText(m.t('composer.remaining', { count: 50 }))).toBeInTheDocument();
  });

  it('types Slovak capitals from the accent bar', async () => {
    const { user } = await openChat();
    const field = screen.getByRole('textbox', { name: m.t('composer.label') });
    await user.click(field);
    const bar = screen.getByRole('toolbar', { name: m.t('composer.accentBar') });
    await user.click(within(bar).getByRole('button', { name: m.t('composer.shift') }));
    await user.click(within(bar).getByRole('button', { name: 'Ľ' }));
    await user.type(field, 'udia');
    expect(field).toHaveValue('Ľudia');
  });

  it('ends with a summary: errors by type, corrections, one card and a link to review', async () => {
    server.use(mockEndpoint('tutor.end', MOCK_END_SUMMARY));
    const { user } = await openChat();
    await user.click(screen.getByRole('button', { name: m.t('chat.end') }));
    const summary = await screen.findByRole('region', { name: m.t('summary.title') });
    expect(within(summary).getByText(m.t('summary.cardsOne'))).toBeInTheDocument();
    const byType = within(summary).getByRole('list', { name: m.t('summary.byType') });
    expect(byType).toHaveTextContent(`${m.t('errorTypes.case_after_preposition')}2`);
    const corrections = within(summary).getByRole('list', { name: m.t('summary.corrections') });
    expect(within(corrections).getAllByRole('listitem')).toHaveLength(2);
    expect(within(summary).getByRole('link', { name: m.t('summary.toReview') })).toHaveAttribute(
      'href',
      '/review',
    );
    expect(screen.getByRole('heading', { name: en.screens.chat, level: 1 })).toBeInTheDocument();
  });

  it('shows a finished conversation without a composer', async () => {
    await openChat({
      ...EXISTING,
      conversation: { ...EXISTING.conversation, status: 'completed' },
    });
    expect(screen.getByText(m.t('chat.ended'))).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: m.t('composer.label') })).toBeNull();
  });

  it('has loading, not found and error states', async () => {
    server.use(mockEndpoint('tutor.getConversation', FRESH, { delayMs: 50 }));
    const { unmount } = renderRoute(URL);
    expect(await screen.findByRole('status', { name: en.app.loading })).toBeInTheDocument();
    await screen.findByRole('list', { name: m.t('chat.messagesLabel') });
    unmount();

    server.use(mockError('tutor.getConversation', 'not_found'));
    const nf = renderRoute(URL);
    expect(await screen.findByText(m.t('chat.notFound'))).toBeInTheDocument();
    nf.unmount();

    let calls = 0;
    server.use(
      mockEndpoint('tutor.getConversation', () => {
        calls += 1;
        return calls === 1
          ? new Response(JSON.stringify({ error: { code: 'internal', message: 'x' } }), {
              status: 500,
            })
          : FRESH;
      }),
    );
    const user = userEvent.setup();
    renderRoute(URL);
    await user.click(await screen.findByRole('button', { name: m.t('chat.retryLoad') }));
    await screen.findByRole('list', { name: m.t('chat.messagesLabel') });
  });
});

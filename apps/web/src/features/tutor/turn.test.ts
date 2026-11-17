// Stream tests: scripted event sequences through the real client, SSE reader and reducer.
import {
  type ConversationDetail,
  EXAMPLE_IDS,
  examples,
  TUTOR_STREAM_BUDGET_ERROR,
  TUTOR_STREAM_EXAMPLE,
  type TutorStreamEvent,
} from '@app/contracts';
import { HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { api } from '../../lib/api';
import { mockEndpoint, mockError, mockNetworkError, server, sseResponse } from '../../test/utils';
import { type ChatAction, type ChatState, chatReducer, initialChat } from './chatState';
import { prepareMessage, runTurn } from './turn';

const DETAIL = examples['tutor.startConversation'].ok[0]?.response.body as ConversationDetail;
const CONV = EXAMPLE_IDS.conversation;
const CLIENT = '0193a1b2-c3d4-7e5f-8a6b-0000000c0001';
const ERR = EXAMPLE_IDS.tutorError;

/** Runs one turn against the mock server and returns the final state and every action. */
async function play(state: ChatState, content: string, clientId = CLIENT) {
  const actions: ChatAction[] = [];
  let s = state;
  await runTurn(api, { conversationId: CONV, clientId, content }, (a) => {
    actions.push(a);
    s = chatReducer(s, a);
  });
  return { state: s, actions };
}

const analysis = (): TutorStreamEvent => ({
  event: 'analysis',
  data: {
    messageId: CLIENT,
    errors: [
      {
        id: ERR,
        start: 20,
        end: 27,
        given: 'kamarát',
        errorType: 'case_after_preposition',
        status: 'prompted',
      },
    ],
    resolved: [],
  },
});

const done = (content: string, cards: string[] = []): TutorStreamEvent => ({
  event: 'done',
  data: {
    tutorMessage: { id: EXAMPLE_IDS.tutorMessage2, seq: 2, content },
    cardsCreated: cards,
    goal: { criteriaMet: ['c1'] },
    budget: { remainingUsd: 0.5 },
  },
});

describe('a tutor turn', () => {
  it('plays a normal turn: analysis marks the message, deltas grow the reply, done settles it', async () => {
    const seen: string[] = [];
    let s = initialChat(DETAIL);
    server.use(
      mockEndpoint('tutor.sendMessage', () => sseResponse(TUTOR_STREAM_EXAMPLE, { delayMs: 1 })),
    );
    await runTurn(
      api,
      { conversationId: CONV, clientId: CLIENT, content: 'Dnes idem do kina s kamarát.' },
      (a) => {
        s = chatReducer(s, a);
        const reply = s.messages.find((msg) => msg.key === `reply:${CLIENT}`);
        if (a.type === 'delta') seen.push(reply?.content ?? '');
      },
    );
    expect(seen).toEqual(['S kým ', 'S kým ideš do kina?']);
    expect(s.turn).toEqual({ phase: 'idle' });
    expect(s.messages.map((msg) => [msg.role, msg.content, msg.state])).toEqual([
      ['tutor', 'Ideš dnes do mesta?', 'sent'],
      ['learner', 'Dnes idem do kina s kamarát.', 'sent'],
      ['tutor', 'S kým ideš do kina?', 'sent'],
    ]);
    const learner = s.messages[1];
    expect(learner?.id).toBe(EXAMPLE_IDS.learnerMessage1);
    expect(s.errors).toEqual([
      expect.objectContaining({ id: ERR, status: 'prompted', messageId: learner?.id }),
    ]);
    expect(s.errors[0]).not.toHaveProperty('expected');
    expect(s.messages[2]?.id).toBe(EXAMPLE_IDS.tutorMessage2);
    expect(s.criteriaMet).toEqual(['c1']);
    expect(s.remainingUsd).toBe(0.71);
  });

  it('turns an error event in the middle into a failed turn with no half shown reply', async () => {
    server.use(
      mockEndpoint('tutor.sendMessage', [
        analysis(),
        { event: 'delta', data: { text: 'S kým ' } },
        { event: 'error', data: { code: 'upstream_failed', message: 'model down' } },
      ]),
    );
    const { state, actions } = await play(initialChat(DETAIL), 'Dnes idem do kina s kamarát.');
    expect(actions.map((a) => a.type)).toEqual(['send', 'analysis', 'delta', 'failed']);
    expect(state.turn).toMatchObject({
      phase: 'failed',
      clientId: CLIENT,
      code: 'upstream_failed',
      content: 'Dnes idem do kina s kamarát.',
    });
    expect(state.messages.map((msg) => [msg.role, msg.state])).toEqual([
      ['tutor', 'sent'],
      ['learner', 'failed'],
    ]);
  });

  it('retries with the same client id and leaves no duplicate message', async () => {
    const bodies: { clientId: string; content: string }[] = [];
    let call = 0;
    server.use(
      mockEndpoint('tutor.sendMessage', ({ body }) => {
        bodies.push(body);
        call += 1;
        return call === 1
          ? [
              analysis(),
              { event: 'delta', data: { text: 'S kým' } },
              { event: 'error', data: { code: 'upstream_failed', message: 'model down' } },
            ]
          : [
              analysis(),
              { event: 'delta', data: { text: 'S kým ideš do kina?' } },
              done('S kým ideš do kina?'),
            ];
      }),
    );
    const first = await play(initialChat(DETAIL), 'Dnes idem do kina s kamarát.');
    expect(first.state.turn.phase).toBe('failed');
    if (first.state.turn.phase !== 'failed') return;
    const { clientId, content } = first.state.turn;
    const second = await play(first.state, content, clientId);

    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(second.state.messages.filter((msg) => msg.role === 'learner')).toHaveLength(1);
    expect(second.state.messages.map((msg) => [msg.role, msg.content, msg.state])).toEqual([
      ['tutor', 'Ideš dnes do mesta?', 'sent'],
      ['learner', 'Dnes idem do kina s kamarát.', 'sent'],
      ['tutor', 'S kým ideš do kina?', 'sent'],
    ]);
    expect(second.state.errors).toHaveLength(1);
    expect(second.state.turn).toEqual({ phase: 'idle' });
  });

  it('marks the daily budget as used up from the stream', async () => {
    server.use(mockEndpoint('tutor.sendMessage', TUTOR_STREAM_BUDGET_ERROR));
    const { state } = await play(initialChat(DETAIL), 'Ahoj');
    expect(state.budget).toEqual({ exhausted: true, resetsAt: '2026-11-18T08:30:00.000Z' });
    expect(state.turn).toMatchObject({ phase: 'failed', code: 'budget_exceeded' });
  });

  it('marks the budget as used up when the request itself is refused', async () => {
    server.use(mockError('tutor.sendMessage', 'budget_exceeded'));
    const { state } = await play(initialChat(DETAIL), 'Ahoj');
    expect(state.budget.exhausted).toBe(true);
  });

  it('fails the turn on a network error and on a stream that breaks off', async () => {
    server.use(mockNetworkError('tutor.sendMessage', { once: true }));
    const net = await play(initialChat(DETAIL), 'Ahoj');
    expect(net.state.turn).toMatchObject({ phase: 'failed', code: 'network' });

    server.use(
      mockEndpoint('tutor.sendMessage', [analysis(), { event: 'delta', data: { text: 'S' } }]),
    );
    const cut = await play(initialChat(DETAIL), 'Ahoj', '0193a1b2-c3d4-7e5f-8a6b-0000000c0002');
    expect(cut.state.turn).toMatchObject({ phase: 'failed', code: 'stream' });
    expect(cut.state.messages.some((msg) => msg.key.startsWith('reply:'))).toBe(false);
  });

  it('fails the turn on an event the contract does not know', async () => {
    server.use(
      mockEndpoint(
        'tutor.sendMessage',
        () =>
          new HttpResponse('event: surprise\ndata: {}\n\n', {
            headers: { 'Content-Type': 'text/event-stream' },
          }),
      ),
    );
    const { state } = await play(initialChat(DETAIL), 'Ahoj');
    expect(state.turn).toMatchObject({ phase: 'failed', code: 'stream' });
  });

  it('applies resolved errors and shows the expected form only once corrected', async () => {
    const corrected: TutorStreamEvent[] = [
      {
        event: 'analysis',
        data: {
          messageId: '0193a1b2-c3d4-7e5f-8a6b-0000000c0009',
          errors: [],
          resolved: [
            {
              id: ERR,
              status: 'corrected',
              expected: 'kamarátom',
              explanationEn: 'After s, use the instrumental.',
            },
          ],
        },
      },
      done('Dobre.', [EXAMPLE_IDS.noteCase]),
    ];
    server.use(mockEndpoint('tutor.sendMessage', [analysis(), done('S kým?')]));
    const first = await play(initialChat(DETAIL), 'Dnes idem do kina s kamarát.');
    server.use(mockEndpoint('tutor.sendMessage', corrected));
    const second = await play(first.state, 'S kamarát.', '0193a1b2-c3d4-7e5f-8a6b-0000000c0009');
    expect(second.state.errors).toEqual([
      expect.objectContaining({ id: ERR, status: 'corrected', expected: 'kamarátom' }),
    ]);
    expect(second.state.messages.at(-1)?.cardsCreated).toEqual([EXAMPLE_IDS.noteCase]);
  });

  it('sends the message in NFC, trimmed', () => {
    expect(prepareMessage('  Idém s kamarátom.  ')).toBe('Idém s kamarátom.');
  });
});

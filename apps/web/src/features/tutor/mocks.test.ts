// The scripted mock conversation keeps to the contract, so the browser flow tests real shapes.
import {
  EndConversationResultSchema,
  ERROR_TYPES,
  EXAMPLE_IDS,
  examples,
  TutorStreamEventSchema,
} from '@app/contracts';
import { describe, expect, it } from 'vitest';
import { api } from '../../lib/api';
import { m } from './messages';
import { MOCK_END_SUMMARY, MOCK_IDS, scriptedTurn } from './mocks';

const id = (n: number) => `0193a1b2-c3d4-7e5f-8a6b-0000000d${String(n).padStart(4, '0')}`;

describe('tutor mocks', () => {
  it.each([
    ['Dnes idem do kina s kamarát.'],
    ['Idem s kamarátom. Potom ideme do mesto.'],
    ['Do mesto.'],
    ['Rozprávaj dlho.'],
    ['Ahoj'],
  ])('script for "%s" is a valid event sequence', (content) => {
    const events = scriptedTurn(id(1), content);
    for (const e of events) expect(() => TutorStreamEventSchema.parse(e)).not.toThrow();
    expect(events.at(-1)?.event).toBe('done');
    const marks = events[0]?.event === 'analysis' ? events[0].data.errors : [];
    for (const e of marks) expect(content.slice(e.start, e.end)).toBe(e.given);
  });

  it('fails a "chyba" message once, then answers the retry with the same client id', () => {
    expect(scriptedTurn(id(7), 'chyba').at(-1)?.event).toBe('error');
    expect(scriptedTurn(id(7), 'chyba').at(-1)?.event).toBe('done');
  });

  it('corrects "mesto" with one card on the second miss', () => {
    const events = scriptedTurn(id(2), 'Do mesto.');
    const a = events[0];
    expect(a?.event === 'analysis' && a.data.resolved[0]).toMatchObject({
      id: MOCK_IDS.errorMesto,
      status: 'corrected',
      expected: 'mesta',
    });
    const done = events.at(-1);
    expect(done?.event === 'done' && done.data.cardsCreated).toEqual([MOCK_IDS.noteMesta]);
  });

  it('answers the end of a scripted conversation with a valid summary of one card', async () => {
    const stream = await api.tutor.sendMessage({
      params: { id: id(3) },
      body: { clientId: id(4), content: 'Ahoj' },
    });
    for await (const _ of stream) {
      // drain
    }
    const result = await api.tutor.end({ params: { id: id(3) } });
    expect(EndConversationResultSchema.parse(result)).toEqual(MOCK_END_SUMMARY);
    expect(result.cardsCreated).toBe(1);
  });

  it('answers the contract example requests with the contract examples', async () => {
    const ex = examples['tutor.sendMessage'].ok[0];
    const stream = await api.tutor.sendMessage(ex?.request as never);
    const events = [];
    for await (const e of stream) events.push(e);
    expect(events).toEqual(ex?.stream);
    const end = await api.tutor.end({ params: { id: EXAMPLE_IDS.conversation } });
    expect(end).toEqual(examples['tutor.end'].ok[0]?.response.body);
  });

  it('keeps the other tutor endpoints on the contract examples', async () => {
    await expect(api.tutor.scenarios()).resolves.toEqual(
      examples['tutor.scenarios'].ok[0]?.response.body,
    );
  });

  it('has a label for every error type', () => {
    for (const t of ERROR_TYPES) expect(m.messages.errorTypes[t]).toBeTruthy();
  });
});

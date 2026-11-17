// Property: the same answers delivered in any order, in any split into batches, always reach
// the same card state, which is the state of replaying the log in time order.
import {
  type CardSnapshot,
  type Rating,
  type ReviewAnswer,
  SubmitAnswersResultSchema,
} from '@app/contracts';
import { replay } from '@app/srs';
import { uuidv7 } from '@app/testkit';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp, type TestClient } from '../../testing/app';
import { V_MESTE_PHRASE } from '../../testing/suites/notes';

const T0 = Date.parse('2026-11-17T08:30:00.000Z');
const MIN = 60_000;

let t: TestApp;
let me: TestClient;
beforeAll(async () => {
  t = await createTestApp();
  me = t.as();
});
afterAll(() => t.close());

/** A new phrase card made at T0. */
async function newCard(): Promise<string> {
  t.clock.set(new Date(T0));
  const res = await me.post('/notes', {
    id: uuidv7(),
    kind: 'phrase',
    source: 'reader',
    content: V_MESTE_PHRASE,
  });
  expect(res.status, res.text).toBe(200);
  return res.body.card.cardId as string;
}

/** Answer ids whose order matches `i`, so ties in time break the same way on every card. */
let run = 0;
const idFor = (r: number, i: number) =>
  `01900000-${r.toString(16).padStart(4, '0')}-7000-8000-${i.toString(16).padStart(12, '0')}`;

async function deliver(batches: ReviewAnswer[][]): Promise<CardSnapshot> {
  let last: CardSnapshot | undefined;
  for (const answers of batches) {
    const res = await me.post('/review/answers', { clientId: 'prop', answers });
    expect(res.status, res.text).toBe(200);
    last = SubmitAnswersResultSchema.parse(res.body).results[0]?.card;
  }
  if (!last) throw new Error('no result');
  return last;
}

const strip = ({ cardId: _, ...rest }: CardSnapshot) => rest;

describe('sync', () => {
  it('reaches the same card state for any delivery order', async () => {
    const answerArb = fc.record({
      // Minutes after the card was made; equal times are allowed.
      minute: fc.integer({ min: 0, max: 30 * 24 * 60 }),
      rating: fc.constantFrom<Rating>(1, 2, 3, 4),
    });
    await fc.assert(
      fc.asyncProperty(
        fc.array(answerArb, { minLength: 1, maxLength: 6 }),
        fc.array(fc.nat(), { minLength: 6, maxLength: 6 }),
        fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
        async (log, keys, cuts) => {
          run += 1;
          const reference = await newCard();
          const shuffled = await newCard();
          // The server's clock is after every answer.
          t.clock.set(new Date(T0 + 31 * 24 * 60 * MIN));
          const make = (cardId: string, prefix: number) =>
            log.map(
              (a, i): ReviewAnswer => ({
                id: idFor(prefix, i),
                cardId,
                answeredAt: new Date(T0 + a.minute * MIN).toISOString(),
                typed: 'v meste',
                variant: 0,
                clientGrade: 'correct',
                rating: a.rating,
                overridden: true,
                durationMs: 1000,
              }),
            );

          // Reference: one batch in time order.
          const inOrder = [...make(reference, run * 2)].sort(
            (x, y) => Date.parse(x.answeredAt) - Date.parse(y.answeredAt) || (x.id < y.id ? -1 : 1),
          );
          const expected = await deliver([inOrder]);

          // Shuffled: a permutation split into batches.
          const answers = make(shuffled, run * 2 + 1)
            .map((a, i) => ({ a, k: keys[i] ?? 0 }))
            .sort((x, y) => x.k - y.k)
            .map((x) => x.a);
          const batches: ReviewAnswer[][] = [[]];
          answers.forEach((a, i) => {
            (batches[batches.length - 1] as ReviewAnswer[]).push(a);
            if (cuts[i] && i < answers.length - 1) batches.push([]);
          });
          const got = await deliver(batches);
          expect(strip(got)).toEqual(strip(expected));

          // Both equal a replay of the whole log in time order.
          const sorted = log
            .map((a, i) => ({ ...a, i }))
            .sort((x, y) => x.minute - y.minute || x.i - y.i);
          const replayed = replay(
            sorted.map((a) => ({ rating: a.rating, answeredAt: new Date(T0 + a.minute * MIN) })),
            { desiredRetention: 0.9, createdAt: new Date(T0) },
          );
          expect(strip(got)).toEqual(replayed.snapshot);
        },
      ),
      { numRuns: 25 },
    );
  });
});

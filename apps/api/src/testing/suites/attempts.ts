// The shared suite of AttemptsPort. The recorder and B5's real port both pass it. It checks
// what every mastery formula must hold, not the formula itself.
import { BucketMasterySchema } from '@app/contracts';
import { uuidv7 } from '@app/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AttemptRecord, AttemptsPort, PortContext } from '../../ports';
import { createSuiteEnv, type SharedSuiteEnv, type SuiteEnv } from './context';

const AT = '2026-11-17T08:00:00.000Z';

function attempts(n: number, over: Partial<AttemptRecord>): AttemptRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    id: uuidv7(),
    source: 'trainer',
    exerciseId: 'ex-140da36a9f',
    lemmaId: 3,
    case: 'acc',
    number: 'sg',
    gender: 'm_anim',
    correct: true,
    occurredAt: new Date(Date.parse(AT) + i * 60_000).toISOString(),
    ...over,
  }));
}

export function runAttemptsSuite(
  name: string,
  make: (ctx: PortContext) => AttemptsPort | Promise<AttemptsPort>,
  shared?: SharedSuiteEnv,
): void {
  describe(`AttemptsPort suite: ${name}`, () => {
    let env: SuiteEnv;
    let port: AttemptsPort;
    beforeAll(async () => {
      env = shared ? shared() : await createSuiteEnv();
      port = await make(env.ctx);
    });
    afterAll(async () => {
      if (!shared) await env.close();
    });

    const find = (list: Awaited<ReturnType<AttemptsPort['getMastery']>>, key: string) =>
      list.find((m) => `${m.case}.${m.number}.${m.gender}` === key);

    it('mastery follows the attempts, per learner, and a repeated id counts once', async () => {
      const a = await env.learner();
      const b = await env.learner();
      const good = attempts(4, {});
      const bad = attempts(4, {
        exerciseId: 'ex-3fa94c21d0',
        lemmaId: 20,
        case: 'loc',
        number: 'sg',
        gender: 'n',
        correct: false,
        diagnosis: 'other_case',
        errorType: 'case_after_preposition',
        given: 'mesto',
        expected: 'meste',
        givenCase: 'nom',
      });
      await env.db.withUser(a, (tx) => port.record(tx, [...good, ...bad]));
      await env.db.withUser(a, (tx) => port.record(tx, good));

      const mine = await env.db.withUser(a, (tx) => port.getMastery(tx));
      for (const m of mine) BucketMasterySchema.parse(m);
      const strong = find(mine, 'acc.sg.m_anim');
      const weak = find(mine, 'loc.sg.n');
      expect(strong?.attempts).toBe(4);
      expect(weak?.attempts).toBe(4);
      expect(strong?.mastery ?? 0).toBeGreaterThan(weak?.mastery ?? 1);
      expect(weak?.level).not.toBe('strong');

      const theirs = await env.db.withUser(b, (tx) => port.getMastery(tx));
      expect(find(theirs, 'acc.sg.m_anim')?.attempts ?? 0).toBe(0);
    });

    it('records an empty list', async () => {
      const a = await env.learner();
      await env.db.withUser(a, (tx) => port.record(tx, []));
    });
  });
}

// The real AnalyzerPort on a test database (mini dataset), built as container.ts builds it:
// the shared port suite, the SQL of repo.ts, and the usage rows of its model calls.
import { TextAnalysisSchema } from '@app/contracts';
import { aiCall } from '@app/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runAnalyzerSuite } from '../../testing/suites/analyzer';
import { createSuiteEnv, type SuiteEnv } from '../../testing/suites/context';
import { createAnalyzerPort } from './port';
import { allTriggers, lemmasByIds } from './repo';

let env: SuiteEnv;
beforeAll(async () => {
  env = await createSuiteEnv();
});
afterAll(() => env.close());

runAnalyzerSuite(
  'real',
  (ctx) => createAnalyzerPort(ctx),
  () => env,
);

describe('analyzer port on the database', () => {
  beforeEach(() => env.gateway.reset());

  it('reads lemmas and the trigger list from ling', async () => {
    const [lemmas, triggers] = await env.db.withSystem(
      async (tx) => [await lemmasByIds(tx, [20, 59, 999_999]), await allTriggers(tx)] as const,
    );
    expect(lemmas.map((l) => l.id).sort()).toEqual([20, 59]);
    expect(lemmas.find((l) => l.id === 20)).toMatchObject({
      lemma: 'mesto',
      pos: 'noun',
      gender: 'n',
    });
    expect(triggers.find((t) => t.id === 'prep-v-loc')).toMatchObject({
      kind: 'preposition',
      lemmaId: 50,
      case: 'loc',
    });
    expect(await env.db.withSystem((tx) => lemmasByIds(tx, []))).toEqual([]);
  });

  it('analyses a text with rules, the model and triggers', async () => {
    const port = createAnalyzerPort(env.ctx);
    const userId = await env.learner();
    const body = 'Bývam v Bratislave. Mám päť pekných žien. Vidím ženy.';
    const { analysis, lemmaCounts } = await port.analyzeText(body, { userId });
    TextAnalysisSchema.parse(analysis);
    const all = analysis.sentences.flatMap((s) => s.tokens);
    const at = (w: string) => all.find((t) => body.slice(t.s, t.e) === w);
    expect(at('Bratislave')).toMatchObject({ tag: 's6', m: 'rule', trig: { id: 'prep-v-loc' } });
    expect(at('pekných')).toMatchObject({ tag: 'p2f', m: 'rule', trig: { id: 'num-pat' } });
    expect(at('ženy')).toMatchObject({ l: 11, m: 'model' });
    expect(lemmaCounts[11]).toBe(2);
    // Model calls go out under the learner and are logged as theirs alone.
    const calls = env.gateway.callsFor('reader.disambiguate');
    expect(calls.map((c) => c.userId)).toEqual([userId]);
    const rows = await env.db.db.select().from(aiCall).where(eq(aiCall.userId, userId));
    expect(rows.map((r) => r.route)).toEqual(['reader.disambiguate']);
    const other = await env.learner();
    expect(await env.db.db.select().from(aiCall).where(eq(aiCall.userId, other))).toEqual([]);
  });

  it('stores nothing for the learner apart from the usage row', async () => {
    const port = createAnalyzerPort(env.ctx);
    const userId = await env.learner();
    await port.analyzeText('Idem do mesta.', { userId });
    const rows = await env.db.db.select().from(aiCall).where(eq(aiCall.userId, userId));
    // Nothing was ambiguous: no model call, no row.
    expect(rows).toEqual([]);
    expect(env.gateway.calls).toHaveLength(0);
  });
});

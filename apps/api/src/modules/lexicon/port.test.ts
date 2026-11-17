// The real lexicon ports on PGlite with the mini dataset and the mock gateway. Every suite and
// test of this file shares one test database.
import {
  FormCandidateSchema,
  foldAscii,
  LemmaSchema,
  ParadigmSchema,
  SenseSchema,
} from '@app/contracts';
import { aiCall, type Database, queryRows, sense } from '@app/db';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortContext } from '../../ports';
import { createSuiteEnv, type SuiteEnv } from '../../testing/suites/context';
import { runDictionarySuite } from '../../testing/suites/dictionary';
import { runMorphologySuite } from '../../testing/suites/morphology';
import { createDictionaryPort, createMorphologyPort } from './port';
import * as repo from './repo';
import { buildFormTables, GlossAnswerSchema } from './service';

const MESTO = 20;
const LUDIA = 28;
const DEN = 30;
const BRATISLAVA = 31;
const PEKNY = 32;
const JA = 37;
const MAT = 61;

let env: SuiteEnv;
beforeAll(async () => {
  env = await createSuiteEnv();
});
afterAll(() => env.close());
const shared = () => env;

runMorphologySuite('real', (ctx) => createMorphologyPort(ctx), shared);
runDictionarySuite('real', (ctx) => createDictionaryPort(ctx), shared);

/** Counts the statements that run outside a transaction (drizzle's pglite session). */
function countQueries(database: Database) {
  const pg = database.pglite;
  if (!pg) throw new Error('pglite expected');
  return vi.spyOn(pg, 'query');
}

describe('MorphologyPort (real): lookupForms', () => {
  it('answers 1,000 words with one query and caches them', async () => {
    const forms = (
      await queryRows<{ form: string }>(env.db.db, sql`select form from ling.form order by form`)
    ).map((r) => r.form);
    const words: string[] = [];
    for (let i = 0; words.length < 1000; i++)
      words.push(i < forms.length ? (forms[i] as string) : `neznáme${i}`);
    const port = createMorphologyPort(env.ctx);
    const spy = countQueries(env.db);
    try {
      const map = await port.lookupForms(words);
      expect(spy).toHaveBeenCalledTimes(1);
      for (const w of words) expect(map.has(foldAscii(w)), w).toBe(true);
      for (const f of forms) expect(map.get(foldAscii(f))?.some((c) => c.form === f)).toBe(true);
      expect(map.get(foldAscii('neznáme999'))).toEqual([]);
      for (const list of map.values()) for (const c of list) FormCandidateSchema.parse(c);

      spy.mockClear();
      const again = await port.lookupForms(words);
      expect(spy).not.toHaveBeenCalled();
      expect(again).toEqual(map);
    } finally {
      spy.mockRestore();
    }
  });

  it('runs the lookup through the index on the folded form', async () => {
    // A large made up lemma, so the planner prefers the index as it will on the full set.
    await env.db.exec(`
      insert into ling.lemma (id, key, lemma, lemma_ascii, pos) values (900001, 'qx|other|-|1', 'qx', 'qx', 'other');
      insert into ling.form (lemma_id, form, form_ascii, tags)
        select 900001, 'qx' || g, 'qx' || g, '' from generate_series(1, 20000) g;
      analyze ling.form;
    `);
    try {
      const query = repo.selectFormsByAscii(env.db.db, ['mesta', 'ludia']) as unknown as {
        toSQL(): { sql: string; params: unknown[] };
      };
      const { sql: text, params } = query.toSQL();
      expect(text).toContain('"form_ascii" in');
      const plan = await env.db.pglite?.query<{ 'QUERY PLAN': string }>(`explain ${text}`, params);
      const lines = (plan?.rows ?? []).map((r) => r['QUERY PLAN']).join('\n');
      expect(lines).toContain('form_form_ascii_idx');
    } finally {
      await env.db.exec(`
        delete from ling.form where lemma_id = 900001;
        delete from ling.lemma where id = 900001;
        analyze ling.form;
      `);
    }
  });

  it('gives mesta and mestá different tags, exact spelling first', async () => {
    const port = createMorphologyPort(env.ctx);
    const plural = (await port.lookupForms(['mestá'])).get('mesta') ?? [];
    expect(plural.map((c) => c.form)).toEqual(['mestá', 'mesta']);
    expect(plural[0]?.readings.map((r) => r.tag)).toEqual(['p1', 'p4', 'p5']);
    expect(plural[1]?.readings).toEqual([{ tag: 's2', case: 'gen', number: 'sg', gender: 'n' }]);
    const gen = (await port.lookupForms(['mesta'])).get('mesta') ?? [];
    expect(gen.map((c) => c.form)).toEqual(['mesta', 'mestá']);
  });

  it('finds the lower case lemma of a capitalised first word, and a proper name in lower case', async () => {
    const port = createMorphologyPort(env.ctx);
    const map = await port.lookupForms(['Mesto', 'Ľudia', 'Má', 'Ma', 'bratislave', 'XYZZY']);
    expect(map.get('mesto')?.[0]).toMatchObject({ lemmaId: MESTO, form: 'mesto' });
    expect(map.get('ludia')?.[0]).toMatchObject({ lemmaId: LUDIA, form: 'ľudia', lemma: 'ľudia' });
    expect(map.get('ludia')?.[0]?.readings.map((r) => r.tag)).toEqual(['p1', 'p5']);
    // Má and Ma fold alike: the spelling decides which lemma comes first.
    expect(map.get('ma')?.[0]).toMatchObject({ lemmaId: MAT, form: 'má' });
    expect((await port.lookupForms(['Ma'])).get('ma')?.[0]).toMatchObject({
      lemmaId: JA,
      form: 'ma',
    });
    expect(map.get('bratislave')?.[0]).toMatchObject({ lemmaId: BRATISLAVA, form: 'Bratislave' });
    expect(map.get('xyzzy')).toEqual([]);
  });

  it('returns an empty map for no words, and candidates the caller cannot change', async () => {
    const port = createMorphologyPort(env.ctx);
    expect((await port.lookupForms([])).size).toBe(0);
    const c = (await port.lookupForms(['meste'])).get('meste')?.[0];
    expect(Object.isFrozen(c)).toBe(true);
  });

  it('reads on a transaction the caller passes', async () => {
    const port = createMorphologyPort(env.ctx, { forms: 0, paradigms: 0, lemmas: 0 });
    const learner = await env.learner();
    const result = await env.db.withUser(learner, async (tx) => ({
      forms: await port.lookupForms(['meste'], tx),
      paradigm: await port.getParadigm(MESTO, tx),
      lemma: await port.getLemma(MESTO, tx),
      found: await port.findLemma('mesto', 'noun', tx),
      verified: await port.verifyForm('meste', { case: 'loc' }, tx),
    }));
    expect(result.forms.get('meste')?.[0]?.lemmaId).toBe(MESTO);
    expect(result.paradigm.forms.length).toBeGreaterThan(0);
    expect(result.lemma?.id).toBe(MESTO);
    expect(result.found.map((l) => l.id)).toEqual([MESTO]);
    expect(result.verified.length).toBe(1);
  });
});

describe('MorphologyPort (real): paradigm, verifyForm, lemmas', () => {
  it('getParadigm lists forms in table order and caches them', async () => {
    const port = createMorphologyPort(env.ctx);
    const p = ParadigmSchema.parse(await port.getParadigm(MESTO));
    expect(p.forms[0]).toEqual({
      form: 'mesto',
      readings: [
        { tag: 's1', case: 'nom', number: 'sg', gender: 'n' },
        { tag: 's4', case: 'acc', number: 'sg', gender: 'n' },
        { tag: 's5', case: 'voc', number: 'sg', gender: 'n' },
      ],
    });
    const spy = countQueries(env.db);
    try {
      await port.getParadigm(MESTO);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    await expect(port.getParadigm(999_999)).rejects.toThrow(/unknown lemma/);
  });

  it('arranges a noun as one table: cases as rows, singular and plural as columns', async () => {
    const port = createMorphologyPort(env.ctx);
    const [table, ...rest] = buildFormTables(await port.getParadigm(MESTO));
    expect(rest).toEqual([]);
    expect(table?.gender).toBeNull();
    expect(table?.columns).toEqual(['sg', 'pl']);
    expect(table?.rows.map((r) => r.case)).toEqual([
      'nom',
      'gen',
      'dat',
      'acc',
      'voc',
      'loc',
      'ins',
    ]);
    expect(table?.rows[1]?.cells).toMatchObject({ sg: ['mesta'], pl: ['miest'] });
    expect(table?.rows[5]?.cells).toMatchObject({ sg: ['meste'], pl: ['mestách'] });
  });

  it('a plural only noun has one column, a pronoun the column x', async () => {
    const port = createMorphologyPort(env.ctx);
    const [ludia] = buildFormTables(await port.getParadigm(LUDIA));
    expect(ludia?.columns).toEqual(['pl']);
    expect(ludia?.rows.find((r) => r.case === 'ins')?.cells.pl).toEqual(['ľuďmi']);
    const [ja] = buildFormTables(await port.getParadigm(JA));
    expect(ja?.columns).toEqual(['x']);
    expect(ja?.rows.find((r) => r.case === 'dat')?.cells.x).toEqual(
      expect.arrayContaining(['mi', 'mne']),
    );
  });

  it('an adjective has one table per gender', async () => {
    const port = createMorphologyPort(env.ctx);
    const tables = buildFormTables(await port.getParadigm(PEKNY));
    expect(tables.map((t) => t.gender)).toEqual(['m_anim', 'm_inan', 'f', 'n']);
    const f = tables.find((t) => t.gender === 'f');
    expect(f?.rows.find((r) => r.case === 'nom')?.cells).toMatchObject({
      sg: ['pekná'],
      pl: ['pekné'],
    });
    const mAnim = tables.find((t) => t.gender === 'm_anim');
    expect(mAnim?.rows.find((r) => r.case === 'nom')?.cells.pl).toEqual(['pekní']);
    // A verb has no case forms.
    expect(buildFormTables(await port.getParadigm(MAT))).toEqual([]);
  });

  it('verifyForm checks lemma, case and number, and keeps capitals at the sentence start', async () => {
    const port = createMorphologyPort(env.ctx);
    const loc = await port.verifyForm('Meste', { lemmaId: MESTO, case: 'loc', number: 'sg' });
    expect(loc).toHaveLength(1);
    expect(loc[0]?.readings).toEqual([{ tag: 's6', case: 'loc', number: 'sg', gender: 'n' }]);
    expect(await port.verifyForm('mesta', { lemmaId: MESTO, number: 'pl' })).toEqual([]);
    expect(await port.verifyForm('mesta', { lemmaId: MESTO, case: 'gen' })).toHaveLength(1);
    expect(await port.verifyForm('mesta', { lemmaId: 21 })).toEqual([]);
    // The accents must match: mesta is not mestá.
    const pl = await port.verifyForm('mestá', { case: 'nom' });
    expect(pl.map((c) => c.form)).toEqual(['mestá']);
  });

  it('getLemma, findLemma and their caches', async () => {
    const port = createMorphologyPort(env.ctx);
    const l = LemmaSchema.parse(await port.getLemma(LUDIA));
    expect(l).toMatchObject({ id: LUDIA, lemma: 'ľudia', flags: { pluralOnly: true } });
    const spy = countQueries(env.db);
    try {
      await port.getLemma(LUDIA);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    expect(await port.getLemma(999_999)).toBeNull();
    expect((await port.findLemma(' Ľudia ')).map((x) => x.id)).toEqual([LUDIA]);
    expect((await port.findLemma('bratislava', 'noun')).map((x) => x.id)).toEqual([BRATISLAVA]);
    expect(await port.findLemma('bratislava', 'verb')).toEqual([]);
    expect(await port.findLemma('neznáme')).toEqual([]);
    port.clearCache();
    const spy2 = countQueries(env.db);
    try {
      await port.getLemma(LUDIA);
      expect(spy2).toHaveBeenCalledTimes(1);
    } finally {
      spy2.mockRestore();
    }
  });
});

describe('DictionaryPort (real): ensureGlosses', () => {
  const runtimeRows = (ids: number[]) =>
    env.db.db.select().from(sense).where(inArray(sense.lemmaId, ids));

  beforeEach(async () => {
    env.gateway.reset();
    // Two lemmas lose their glosses, as words beyond the dictionary would have none.
    await env.db.exec('delete from ling.sense where lemma_id in (30, 31)');
  });

  /** The lemma ids a gloss request asked for. */
  const askedIds = (content: string) =>
    (JSON.parse(content) as { lemmas: { lemmaId: number }[] }).lemmas.map((l) => l.lemmaId);

  it('asks reader.gloss once for all missing lemmas, stores the answer and reuses it', async () => {
    const learner = await env.learner();
    let transactionsOpen = 0;
    const database: Database = {
      ...env.db,
      withSystem: async (fn) => {
        transactionsOpen++;
        try {
          return await env.db.withSystem(fn);
        } finally {
          transactionsOpen--;
        }
      },
    };
    const ctx: PortContext = { ...env.ctx, database };
    const port = createDictionaryPort(ctx);
    env.gateway.respond('reader.gloss', (call) => {
      expect(transactionsOpen).toBe(0);
      const ids = askedIds(call.messages[0]?.content ?? '');
      return {
        data: {
          glosses: [
            ...ids.map((lemmaId) => ({
              lemmaId,
              glosses: lemmaId === DEN ? [' day ', 'day', 'daytime'] : ['Bratislava'],
            })),
            { lemmaId: MESTO, glosses: ['not asked'] },
          ],
        },
      };
    });

    const first = await port.ensureGlosses([DEN, MESTO, BRATISLAVA, 999_999, DEN], {
      sentenceSk: 'Cez deň som bol v Bratislave.',
      userId: learner,
    });
    const calls = env.gateway.callsFor('reader.gloss');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.kind).toBe('structured');
    expect(calls[0]?.userId).toBe(learner);
    expect(calls[0]?.system[0]?.cache).toBe(true);
    const input = JSON.parse(calls[0]?.messages[0]?.content ?? '{}');
    expect(input).toEqual({
      lemmas: [
        { lemmaId: DEN, lemma: 'deň', pos: 'noun', gender: 'm_inan' },
        { lemmaId: BRATISLAVA, lemma: 'Bratislava', pos: 'noun', gender: 'f' },
      ],
      sentence: 'Cez deň som bol v Bratislave.',
    });
    expect(first.get(DEN)).toEqual(['day', 'daytime']);
    expect(first.get(BRATISLAVA)).toEqual(['Bratislava']);
    expect(first.get(MESTO)?.length).toBeGreaterThan(0);
    expect(first.get(MESTO)).not.toContain('not asked');
    expect(first.get(999_999)).toEqual([]);

    const rows = await runtimeRows([DEN, BRATISLAVA]);
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r).toMatchObject({ source: 'runtime', verified: false });
    expect(
      (await env.db.db.select().from(sense).where(eq(sense.lemmaId, MESTO))).map((r) => r.source),
    ).not.toContain('runtime');

    // The next call reuses the stored glosses.
    const second = await port.ensureGlosses([DEN, BRATISLAVA], {
      sentenceSk: 'x',
      userId: learner,
    });
    expect(env.gateway.callsFor('reader.gloss')).toHaveLength(1);
    expect(second).toEqual(
      new Map([
        [DEN, ['day', 'daytime']],
        [BRATISLAVA, ['Bratislava']],
      ]),
    );
    const senses = (await port.getSenses([DEN])).get(DEN) ?? [];
    for (const s of senses) SenseSchema.parse(s);
    expect(senses.map((s) => [s.ord, s.glossEn, s.source])).toEqual([
      [0, 'day', 'runtime'],
      [1, 'daytime', 'runtime'],
    ]);

    // The usage row is the learner's, and only the learner's.
    const own = await env.db.withUser(learner, (tx) =>
      tx.select().from(aiCall).where(eq(aiCall.route, 'reader.gloss')),
    );
    expect(own).toHaveLength(1);
    const other = await env.learner();
    const others = await env.db.withUser(other, (tx) =>
      tx.select().from(aiCall).where(eq(aiCall.route, 'reader.gloss')),
    );
    expect(others).toEqual([]);
  });

  it('asks nothing without a learner, and stores nothing when the gateway fails', async () => {
    const port = createDictionaryPort(env.ctx);
    const none = await port.ensureGlosses([DEN, MESTO], { sentenceSk: 'Deň.' });
    expect(none.get(DEN)).toEqual([]);
    expect(none.get(MESTO)?.length).toBeGreaterThan(0);
    expect(env.gateway.calls).toHaveLength(0);

    const learner = await env.learner();
    env.gateway.script('reader.gloss', { error: 'upstream_failed' });
    expect(
      (await port.ensureGlosses([DEN], { sentenceSk: 'Deň.', userId: learner })).get(DEN),
    ).toEqual([]);
    env.gateway.script('reader.gloss', { data: { glosses: [{ lemmaId: DEN }] } });
    expect(
      (await port.ensureGlosses([DEN], { sentenceSk: 'Deň.', userId: learner })).get(DEN),
    ).toEqual([]);
    expect(await runtimeRows([DEN])).toEqual([]);

    // Over the budget: no model call, nothing stored, the reader still gets an answer.
    await env.db.factory.aiCall({ userId: learner, costUsd: '5', createdAt: env.ctx.clock.now() });
    const before = env.gateway.calls.length;
    expect(
      (await port.ensureGlosses([DEN], { sentenceSk: 'Deň.', userId: learner })).get(DEN),
    ).toEqual([]);
    expect(env.gateway.calls.length).toBe(before);

    // A later call asks again and stores.
    const fresh = await env.learner();
    env.gateway.script('reader.gloss', { data: { glosses: [{ lemmaId: DEN, glosses: ['day'] }] } });
    expect(
      (await port.ensureGlosses([DEN], { sentenceSk: 'Deň.', userId: fresh })).get(DEN),
    ).toEqual(['day']);
  });

  it('does not ask for lemmas that exist nowhere, nor for an empty list', async () => {
    const port = createDictionaryPort(env.ctx);
    const learner = await env.learner();
    expect((await port.ensureGlosses([], { sentenceSk: 'Deň.', userId: learner })).size).toBe(0);
    expect(
      (await port.ensureGlosses([999_999, -1], { sentenceSk: 'Deň.', userId: learner })).get(
        999_999,
      ),
    ).toEqual([]);
    expect(env.gateway.calls).toHaveLength(0);
  });

  it('keeps glosses another request stored while the model was answering', async () => {
    const port = createDictionaryPort(env.ctx);
    const learner = await env.learner();
    env.gateway.respond('reader.gloss', async () => {
      await env.db.exec(
        "insert into ling.sense (lemma_id, ord, gloss_en, source) values (30, 0, 'day (first)', 'runtime')",
      );
      return { data: { glosses: [{ lemmaId: DEN, glosses: ['day (second)', 'daylight'] }] } };
    });
    expect(
      (await port.ensureGlosses([DEN], { sentenceSk: 'Deň.', userId: learner })).get(DEN),
    ).toEqual(['day (first)']);
  });

  it('the answer schema refuses empty or overlong glosses', () => {
    expect(
      GlossAnswerSchema.safeParse({ glosses: [{ lemmaId: 1, glosses: ['  '] }] }).success,
    ).toBe(false);
    expect(GlossAnswerSchema.safeParse({ glosses: [{ lemmaId: 1, glosses: [] }] }).success).toBe(
      false,
    );
    expect(
      GlossAnswerSchema.safeParse({ glosses: [{ lemmaId: 1, glosses: ['x'.repeat(81)] }] }).success,
    ).toBe(false);
  });
});

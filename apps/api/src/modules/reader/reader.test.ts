// The reader module over HTTP: import with the stand in analyzer, coverage, translation,
// limits, list and library, and isolation between learners. One test database for the file.
import {
  ErrorResponseSchema,
  endpoints,
  LIMITS,
  type ResponseOf,
  TextAnalysisSchema,
} from '@app/contracts';
import { libraryText } from '@app/db';
import {
  createTestDb,
  MESTO_WORD_CONTENT,
  type TestDb,
  uuidv7,
  V_MESTE_PHRASE_CONTENT,
} from '@app/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnalyzerPort } from '../../ports';
import { createTestApp, type TestApp, type TestClient } from '../../testing/app';

let db: TestDb;
let t: TestApp;

beforeAll(async () => {
  db = await createTestDb({ content: 'mini' });
  t = await createTestApp({ db });
});
afterAll(async () => {
  await t.close();
  await db.close();
});

// Peter is a name inside its sentence; 5 is a number.
const BODY = 'Bývam v meste. Tam má Peter 5 domov.';

/** Parses a response with the endpoint's schema (or the error shape) and returns the body. */
function ok<N extends keyof typeof endpoints>(
  name: N,
  res: { status: number; body: unknown; text: string },
): ResponseOf<N> {
  const ep = endpoints[name];
  expect(res.status, res.text).toBe(ep.status);
  return (ep.response ? ep.response.parse(res.body) : undefined) as ResponseOf<N>;
}

function fails(res: { status: number; body: unknown; text: string }, code: string, status: number) {
  expect(res.status, res.text).toBe(status);
  const body = ErrorResponseSchema.parse(res.body);
  expect(body.error.code).toBe(code);
  return body.error;
}

async function importText(
  app: TestApp,
  as: TestClient,
  body = BODY,
  title?: string,
): Promise<string> {
  const id = uuidv7();
  const res = await as.call('texts.create', { body: { id, body, ...(title ? { title } : {}) } });
  expect(ok('texts.create', res)).toEqual({ id, status: 'processing' });
  await app.drain();
  return id;
}

describe('import', () => {
  it('moves from processing to ready with the stand in analyzer', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const slow: AnalyzerPort = {
      analyzeText: async (body, opts) => {
        await gate;
        return t.ports.analyzer.analyzeText(body, opts);
      },
    };
    const s = await createTestApp({ db, ports: { analyzer: slow } });
    try {
      const me = s.as();
      const id = uuidv7();
      ok('texts.create', await me.call('texts.create', { body: { id, body: BODY } }));
      const before = ok('texts.get', await me.call('texts.get', { params: { id } }));
      expect(before.status).toBe('processing');
      expect(before.analysis).toBeNull();
      release();
      await s.drain();
      const after = ok('texts.get', await me.call('texts.get', { params: { id } }));
      expect(after.status).toBe('ready');
      expect(after.error).toBeNull();
      TextAnalysisSchema.parse(after.analysis);
      expect(after.analysis?.sentences).toHaveLength(2);
      expect(after.tokenCount).toBe(7);
      expect(after.uniqueLemmaCount).toBeGreaterThan(0);
      expect(after.coverage).not.toBeNull();
      expect(after.title).toBe(BODY);
    } finally {
      await s.close();
    }
  });

  it('ends as failed with a message when the analyzer fails, and keeps the text', async () => {
    const broken: AnalyzerPort = {
      analyzeText: async () => {
        throw new Error('database password is hunter2');
      },
    };
    const s = await createTestApp({ db, ports: { analyzer: broken } });
    try {
      const me = s.as();
      const id = await importText(s, me, BODY, 'Môj text');
      const text = ok('texts.get', await me.call('texts.get', { params: { id } }));
      expect(text.status).toBe('failed');
      expect(text.error).toBe('The text could not be analysed.');
      expect(text.body).toBe(BODY);
      expect(text.title).toBe('Môj text');
      const list = ok('texts.list', await me.call('texts.list'));
      expect(list.items.map((x) => x.id)).toEqual([id]);
    } finally {
      await s.close();
    }
  });

  it('fails an analysis that does not match the contract', async () => {
    const wrong = {
      analyzeText: async () => ({ analysis: { v: 2 }, tokenCount: 0, lemmaCounts: {} }),
    } as unknown as AnalyzerPort;
    const s = await createTestApp({ db, ports: { analyzer: wrong } });
    try {
      const me = s.as();
      const id = await importText(s, me);
      expect(ok('texts.get', await me.call('texts.get', { params: { id } })).status).toBe('failed');
    } finally {
      await s.close();
    }
  });

  it('answers a repeated id with the stored status and 200, and another body with conflict', async () => {
    const me = t.as();
    const id = await importText(t, me);
    const again = await me.call('texts.create', { body: { id, body: BODY } });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ id, status: 'ready' });
    fails(await me.call('texts.create', { body: { id, body: 'Iný text.' } }), 'conflict', 409);
    // Another learner cannot take the id either.
    fails(await t.as().call('texts.create', { body: { id, body: BODY } }), 'conflict', 409);
  });

  it('refuses a body of 20,001 characters with validation_failed', async () => {
    const me = t.as();
    const res = await me.call('texts.create', {
      body: { id: uuidv7(), body: 'a'.repeat(LIMITS.textImportChars + 1) },
    });
    const err = fails(res, 'validation_failed', 400);
    expect(Object.keys((err.details as { fields: object }).fields)).toContain('body.body');
    const max = await me.call('texts.create', {
      body: { id: uuidv7(), body: 'a'.repeat(LIMITS.textImportChars) },
    });
    expect(max.status).toBe(202);
    await t.drain();
  });

  it('refuses the eleventh import of an hour with rate_limited', async () => {
    const s = await createTestApp({ db });
    try {
      const me = s.as();
      for (let i = 0; i < LIMITS.textImportsPerHour; i += 1) {
        await importText(s, me, `Veta číslo ${i}.`);
        s.clock.advance(60_000);
      }
      const res = await me.call('texts.create', { body: { id: uuidv7(), body: BODY } });
      const err = fails(res, 'rate_limited', 429);
      // The first import was 10 minutes ago: it leaves the window in 50 minutes.
      expect(err.details).toEqual({ retryAfterSeconds: 50 * 60 });
      // Another learner is not limited.
      ok('texts.create', await s.as().call('texts.create', { body: { id: uuidv7(), body: BODY } }));
      s.clock.advance(50 * 60_000);
      ok('texts.create', await me.call('texts.create', { body: { id: uuidv7(), body: BODY } }));
      await s.drain();
    } finally {
      await s.close();
    }
  });
});

describe('coverage', () => {
  it('rises on the next opening after a lemma is marked known', async () => {
    const me = t.as();
    const id = await importText(t, me);
    const first = ok('texts.get', await me.call('texts.get', { params: { id } }));
    const meste = first.analysis?.sentences[0]?.tokens.find(
      (x) => BODY.slice(x.s, x.e) === 'meste',
    );
    expect(meste?.l).toBe(20);
    expect(first.lemmaStatus['20']).toBe('unknown');
    const before = first.coverage ?? 0;

    await db.factory.userLemma({
      userId: me.id as string,
      lemmaId: 20,
      status: 'known',
      source: 'reader',
    });
    const second = ok('texts.get', await me.call('texts.get', { params: { id } }));
    expect(second.lemmaStatus['20']).toBe('known');
    expect(second.coverage).toBeGreaterThan(before);
    // The stored coverage follows, so the list shows it too.
    const listed = ok('texts.list', await me.call('texts.list')).items.find((x) => x.id === id);
    expect(listed?.coverage).toBeCloseTo(second.coverage ?? -1, 5);
  });

  it('counts names and numbers as known, and a word card past 21 days as known', async () => {
    const me = t.as();
    const id = await importText(t, me);
    const text = ok('texts.get', await me.call('texts.get', { params: { id } }));
    const words = text.analysis?.sentences.flatMap((s) => s.tokens).filter((x) => x.t !== 'punct');
    // Peter (a name) and 5 (a number) are known before the learner knows any word.
    const known = words?.filter((x) => {
      const w = BODY.slice(x.s, x.e);
      return w === 'Peter' || w === '5';
    });
    expect(known).toHaveLength(2);
    expect(text.coverage).toBeCloseTo(2 / (words?.length ?? 1), 5);

    const n = await db.factory.note({
      userId: me.id as string,
      kind: 'word',
      lemmaId: 20,
      content: MESTO_WORD_CONTENT,
    });
    const learning = ok('texts.get', await me.call('texts.get', { params: { id } }));
    expect(learning.lemmaStatus['20']).toBe('learning');
    expect(learning.coverage).toBeCloseTo(text.coverage ?? -1, 5);

    await db.factory.card({
      userId: me.id as string,
      noteId: n.id,
      stability: 30,
      state: 'review',
    });
    const known30 = ok('texts.get', await me.call('texts.get', { params: { id } }));
    expect(known30.lemmaStatus['20']).toBe('known');
    expect(known30.coverage).toBeCloseTo(3 / (words?.length ?? 1), 5);

    await db.factory.userLemma({
      userId: me.id as string,
      lemmaId: 50,
      status: 'ignored',
      source: 'triage',
    });
    const ignored = ok('texts.get', await me.call('texts.get', { params: { id } }));
    expect(ignored.lemmaStatus['50']).toBe('ignored');
    expect(ignored.coverage).toBeCloseTo(4 / (words?.length ?? 1), 5);
  });
});

describe('reading', () => {
  it('returns saved phrases with their position in the body', async () => {
    const me = t.as();
    const id = await importText(t, me, 'Dnes je pekný deň. Bývam v meste.');
    await db.factory.note({ userId: me.id as string, textId: id, content: V_MESTE_PHRASE_CONTENT });
    const text = ok('texts.get', await me.call('texts.get', { params: { id } }));
    expect(text.phrases).toHaveLength(1);
    const p = text.phrases[0];
    expect(p?.textSk).toBe('v meste');
    expect(p?.glossEn).toBe('in the town');
    expect(text.body.slice(p?.span?.start, p?.span?.end)).toBe('v meste');
  });

  it('renames, saves the position, archives and deletes', async () => {
    const me = t.as();
    const id = await importText(t, me);
    const opened = ok('texts.get', await me.call('texts.get', { params: { id } }));
    expect(opened.lastOpenedAt).toBe(t.clock.now().toISOString());

    const renamed = ok(
      'texts.update',
      await me.call('texts.update', { params: { id }, body: { title: 'Doma' } }),
    );
    expect(renamed.title).toBe('Doma');
    const moved = ok(
      'texts.update',
      await me.call('texts.update', { params: { id }, body: { progress: { sentence: 1 } } }),
    );
    expect(moved.progress).toEqual({ sentence: 1 });
    fails(
      await me.call('texts.update', { params: { id }, body: { progress: { sentence: 9 } } }),
      'conflict',
      409,
    );
    ok('texts.update', await me.call('texts.update', { params: { id }, body: { archived: true } }));
    expect(ok('texts.list', await me.call('texts.list')).items).toHaveLength(0);
    const archived = ok('texts.list', await me.call('texts.list', { query: { archived: 'true' } }));
    expect(archived.items.map((x) => x.id)).toEqual([id]);

    expect((await me.call('texts.delete', { params: { id } })).status).toBe(204);
    fails(await me.call('texts.get', { params: { id } }), 'not_found', 404);
    fails(await me.call('texts.delete', { params: { id } }), 'not_found', 404);
  });

  it('pages the list with a cursor, last opened first', async () => {
    const s = await createTestApp({ db });
    try {
      const me = s.as();
      const ids: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        ids.push(await importText(s, me, `Text ${i}.`));
        s.clock.advance(1000);
      }
      // Opening the oldest text moves it to the top.
      ok('texts.get', await me.call('texts.get', { params: { id: ids[0] as string } }));
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const query: { limit: number; cursor?: string } = { limit: 2 };
        if (cursor) query.cursor = cursor;
        const page = ok('texts.list', await me.call('texts.list', { query: query as never }));
        expect(page.items.length).toBeLessThanOrEqual(2);
        seen.push(...page.items.map((x) => x.id));
        cursor = page.nextCursor;
      } while (cursor);
      expect(seen).toEqual([ids[0], ids[4], ids[3], ids[2], ids[1]]);
      await s.drain();
    } finally {
      await s.close();
    }
  });
});

describe('sentence translation', () => {
  it('calls the gateway once per sentence, however often it is requested', async () => {
    const me = t.as();
    const id = await importText(t, me);
    t.gateway.reset();
    t.gateway.script('reader.translate', { data: { en: 'Peter has 5 houses.' } });
    const first = ok(
      'texts.translateSentence',
      await me.call('texts.translateSentence', { params: { id, n: 1 } }),
    );
    expect(first).toEqual({ n: 1, en: 'Peter has 5 houses.' });
    for (let i = 0; i < 3; i += 1) {
      const again = ok(
        'texts.translateSentence',
        await me.call('texts.translateSentence', { params: { id, n: 1 } }),
      );
      expect(again).toEqual(first);
    }
    expect(t.gateway.callsFor('reader.translate')).toHaveLength(1);
    const call = t.gateway.callsFor('reader.translate')[0];
    expect(call?.messages[0]?.content).toContain('<sentence>Tam má Peter 5 domov.</sentence>');
    expect(call?.messages[0]?.content).toContain('<context>Bývam v meste.</context>');
    expect(call?.system.some((b) => b.cache)).toBe(true);
    // Stored in the analysis.
    const text = ok('texts.get', await me.call('texts.get', { params: { id } }));
    expect(text.analysis?.sentences[1]?.en).toBe('Peter has 5 houses.');
    expect(text.analysis?.sentences[0]?.en).toBeUndefined();
  });

  it('shares one call between overlapping requests for the same sentence', async () => {
    const me = t.as();
    const id = await importText(t, me);
    t.gateway.reset();
    t.gateway.script('reader.translate', { data: { en: 'I live in town.' } });
    const all = await Promise.all(
      [0, 1, 2].map(() => me.call('texts.translateSentence', { params: { id, n: 0 } })),
    );
    for (const r of all) expect(ok('texts.translateSentence', r).en).toBe('I live in town.');
    expect(t.gateway.callsFor('reader.translate')).toHaveLength(1);
  });

  it('answers not_found for a missing sentence, conflict before the analysis, 429 at the budget', async () => {
    const me = t.as();
    const id = await importText(t, me);
    t.gateway.reset();
    fails(await me.call('texts.translateSentence', { params: { id, n: 7 } }), 'not_found', 404);
    const failing = await createTestApp({
      db,
      ports: {
        analyzer: {
          analyzeText: async () => {
            throw new Error('down');
          },
        },
      },
    });
    try {
      const other = failing.as();
      const bad = await importText(failing, other);
      fails(
        await other.call('texts.translateSentence', { params: { id: bad, n: 0 } }),
        'conflict',
        409,
      );
    } finally {
      await failing.close();
    }
    await db.factory.aiCall({ userId: me.id as string, costUsd: '5', createdAt: t.clock.now() });
    const res = await me.call('texts.translateSentence', { params: { id, n: 0 } });
    fails(res, 'budget_exceeded', 429);
    expect(t.gateway.callsFor('reader.translate')).toHaveLength(0);
  });

  it('answers a failed model call with upstream_failed and stores nothing', async () => {
    const me = t.as();
    const id = await importText(t, me);
    t.gateway.reset();
    t.gateway.script('reader.translate', { error: 'refused' });
    fails(
      await me.call('texts.translateSentence', { params: { id, n: 0 } }),
      'upstream_failed',
      502,
    );
    const text = ok('texts.get', await me.call('texts.get', { params: { id } }));
    expect(text.analysis?.sentences[0]?.en).toBeUndefined();
  });
});

describe('library', () => {
  it('lists the library with this learner’s coverage, and adds a copy with its analysis', async () => {
    const me = t.as();
    const list = ok('library.list', await me.call('library.list'));
    const lib = list.items.find((x) => x.id === 'lib-001');
    expect(lib).toMatchObject({ id: 'lib-001', title: 'Môj deň', level: 'A2', tokenCount: 77 });
    expect(lib?.textId).toBeUndefined();
    const base = lib?.coverage ?? 0;
    expect(base).toBeGreaterThan(0); // names and numbers

    const id = uuidv7();
    t.gateway.reset();
    const added = ok(
      'library.add',
      await me.call('library.add', { params: { id: 'lib-001' }, body: { id } }),
    );
    expect(added).toEqual({ id, status: 'ready' });
    const again = ok(
      'library.add',
      await me.call('library.add', { params: { id: 'lib-001' }, body: { id } }),
    );
    expect(again).toEqual(added);

    const text = ok('texts.get', await me.call('texts.get', { params: { id } }));
    expect(text).toMatchObject({
      source: 'library',
      sourceRef: 'lib-001',
      status: 'ready',
      tokenCount: 77,
    });
    expect(text.coverage).toBeCloseTo(base, 5);
    // Library sentences come translated: no model call.
    ok(
      'texts.translateSentence',
      await me.call('texts.translateSentence', { params: { id, n: 0 } }),
    );
    expect(t.gateway.callsFor('reader.translate')).toHaveLength(0);

    await db.factory.userLemma({
      userId: me.id as string,
      lemmaId: 64,
      status: 'known',
      source: 'reader',
    });
    const after = ok('library.list', await me.call('library.list')).items.find(
      (x) => x.id === 'lib-001',
    );
    expect(after?.textId).toBe(id);
    expect(after?.coverage).toBeGreaterThan(base);
    // Other learners see no copy.
    const theirs = ok('library.list', await t.as().call('library.list')).items[0];
    expect(theirs?.textId).toBeUndefined();

    fails(
      await me.call('library.add', { params: { id: 'lib-404' }, body: { id: uuidv7() } }),
      'not_found',
      404,
    );
  });

  it('runs the import when the library text has no analysis', async () => {
    await db.db.insert(libraryText).values({
      id: 'lib-test-raw',
      title: 'Bez analýzy',
      body: BODY,
      level: 'A1',
      source: 'authored',
      license: 'CC BY 4.0',
      ord: 99,
    });
    const me = t.as();
    const lib = ok('library.list', await me.call('library.list')).items.find(
      (x) => x.id === 'lib-test-raw',
    );
    expect(lib).toMatchObject({ coverage: null, tokenCount: 7 });
    const id = uuidv7();
    const added = ok(
      'library.add',
      await me.call('library.add', { params: { id: 'lib-test-raw' }, body: { id } }),
    );
    expect(added).toEqual({ id, status: 'processing' });
    await t.drain();
    const text = ok('texts.get', await me.call('texts.get', { params: { id } }));
    expect(text.status).toBe('ready');
    expect(text.analysis?.sentences).toHaveLength(2);
  });
});

describe('isolation', () => {
  it('gives user B not_found for user A’s text on every endpoint', async () => {
    const a = t.as();
    const b = t.as();
    const id = await importText(t, a);
    t.gateway.reset();
    t.gateway.script('reader.translate', { data: { en: 'x' } });
    fails(await b.call('texts.get', { params: { id } }), 'not_found', 404);
    fails(await b.call('texts.update', { params: { id }, body: { title: 'B' } }), 'not_found', 404);
    fails(await b.call('texts.delete', { params: { id } }), 'not_found', 404);
    fails(await b.call('texts.translateSentence', { params: { id, n: 0 } }), 'not_found', 404);
    expect(t.gateway.callsFor('reader.translate')).toHaveLength(0);
    expect(ok('texts.list', await b.call('texts.list')).items).toEqual([]);
    fails(
      await b.call('library.add', { params: { id: 'lib-001' }, body: { id } }),
      'conflict',
      409,
    );
    // A's text is untouched.
    const mine = ok('texts.get', await a.call('texts.get', { params: { id } }));
    expect(mine.title).toBe(BODY);
  });

  it('needs a token', async () => {
    fails(await t.anon.call('texts.list'), 'unauthorized', 401);
  });
});

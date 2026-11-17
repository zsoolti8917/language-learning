// Words track: bands, the band list, sorting, the word page and the status of one word.
// One test database for the file: the mini dataset plus generated lemmas ranked 73 to 2500
// (testing/lemmas.ts), so bands 0 and 1 are full and band 2 holds 500 words.
import {
  CASES,
  endpoints,
  LemmaDetailSchema,
  NUMBERS,
  TriageResultSchema,
  WordBandsSchema,
  WordListSchema,
} from '@app/contracts';
import { note, userLemma } from '@app/db';
import { createTestDb, type TestDb } from '@app/testkit';
import { MINI_LEMMA_IDS } from '@app/testkit/mini';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../../testing/app';
import { createDbNotes, type DbNotes } from './testing/db-notes';
import { addRankedLemmas, GENERATED_ID_BASE } from './testing/lemmas';

const MESTO = 20;
let db: TestDb;
let t: TestApp;
let notes: DbNotes;

beforeAll(async () => {
  db = await createTestDb({ content: 'mini' });
  await addRankedLemmas(db, 73, 2500);
  notes = createDbNotes();
  t = await createTestApp({ db, ports: { notes } });
});

afterAll(async () => {
  await t?.close();
  await db?.close();
});

async function statusRows(userId: string) {
  return db.db.select().from(userLemma).where(eq(userLemma.userId, userId));
}

describe('GET /words/bands', () => {
  it('lists three bands of 1,000 ranks with counts per status', async () => {
    const a = t.as();
    const before = await a.call('words.bands');
    expect(before.status).toBe(200);
    expect(WordBandsSchema.parse(before.body)).toEqual({
      bands: [
        { band: 0, fromRank: 1, toRank: 1000, total: 1000, known: 0, learning: 0, unknown: 1000 },
        {
          band: 1,
          fromRank: 1001,
          toRank: 2000,
          total: 1000,
          known: 0,
          learning: 0,
          unknown: 1000,
        },
        { band: 2, fromRank: 2001, toRank: 3000, total: 500, known: 0, learning: 0, unknown: 500 },
      ],
    });

    const triage = await a.call('words.triage', {
      body: {
        decisions: [
          { lemmaId: MESTO, decision: 'known' },
          { lemmaId: 6, decision: 'learn' },
          { lemmaId: 12, decision: 'ignored' },
          { lemmaId: GENERATED_ID_BASE + 1500, decision: 'known' },
        ],
      },
    });
    expect(triage.status).toBe(200);
    const after = WordBandsSchema.parse((await a.call('words.bands')).body);
    expect(after.bands[0]).toMatchObject({ total: 1000, known: 1, learning: 1, unknown: 997 });
    expect(after.bands[1]).toMatchObject({ total: 1000, known: 1, learning: 0, unknown: 999 });
  });
});

describe('GET /words', () => {
  it('pages through a band in rank order', async () => {
    const a = t.as();
    const seen: number[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: Record<string, string | number> = { band: 0, limit: 200 };
      if (cursor) query.cursor = cursor;
      const res = await a.call('words.list', { query: query as never });
      expect(res.status).toBe(200);
      const page = WordListSchema.parse(res.body);
      seen.push(...page.items.map((i) => i.rank));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(5);
    expect(seen).toEqual(Array.from({ length: 1000 }, (_, i) => i + 1));
  });

  it('gives each word its gloss, status and top forms', async () => {
    const a = t.as();
    await a.call('lemmas.setStatus', { params: { id: MESTO }, body: { status: 'known' } });
    const res = await a.call('words.list', { query: { band: 0, limit: 72 } });
    const items = WordListSchema.parse(res.body).items;
    const mesto = items.find((i) => i.lemmaId === MESTO);
    expect(mesto).toMatchObject({ lemma: 'mesto', pos: 'noun', status: 'known' });
    expect(mesto?.glossEn).toBeTruthy();
    expect(mesto?.topForms.length).toBeGreaterThan(0);
  });

  it('filters by status; unknown includes words without a row', async () => {
    const a = t.as();
    await a.call('words.triage', {
      body: {
        decisions: [
          { lemmaId: 1, decision: 'known' },
          { lemmaId: 2, decision: 'known' },
          { lemmaId: 3, decision: 'ignored' },
        ],
      },
    });
    const known = WordListSchema.parse(
      (await a.call('words.list', { query: { band: 0, status: 'known' } })).body,
    );
    expect(known.items.map((i) => i.lemmaId).sort()).toEqual([1, 2]);
    const unknown = WordListSchema.parse(
      (await a.call('words.list', { query: { band: 0, status: 'unknown', limit: 5 } })).body,
    );
    expect(unknown.items.map((i) => i.lemmaId)).not.toContain(1);
    expect(unknown.items.map((i) => i.lemmaId)).not.toContain(3);
    expect(unknown.items).toHaveLength(5);
    expect(unknown.nextCursor).not.toBeNull();
  });

  it('refuses a bad cursor and a band past the last', async () => {
    const a = t.as();
    expect((await a.get('/words?cursor=nope')).body.error.code).toBe('validation_failed');
    expect((await a.get('/words?band=3')).status).toBe(400);
  });
});

describe('POST /words/triage', () => {
  it('sorts 200 words in one transaction and creates notes only for the words to learn', async () => {
    const a = t.as();
    const ids = Array.from({ length: 200 }, (_, i) => GENERATED_ID_BASE + 100 + i);
    const decisions = ids.map((lemmaId, i) => ({
      lemmaId,
      decision: i < 120 ? 'known' : i < 150 ? 'ignored' : 'learn',
    })) as { lemmaId: number; decision: 'known' | 'ignored' | 'learn' }[];
    await a.call('words.bands'); // the first call creates the profile in a transaction of its own
    const notesBefore = notes.notes.length;
    const txsBefore = notes.txs.length;
    const spy = vi.spyOn(t.deps.database, 'withUser');
    const res = await a.call('words.triage', { body: { decisions } });
    const transactions = spy.mock.calls.length;
    spy.mockRestore();

    expect(res.status).toBe(200);
    expect(TriageResultSchema.parse(res.body)).toEqual({ updated: 200, notesCreated: 50 });
    expect(transactions).toBe(1);
    const txs = notes.txs.slice(txsBefore);
    expect(new Set(txs).size).toBe(1);
    const created = notes.notes.slice(notesBefore);
    expect(created.map((n) => n.kind === 'word' && n.input.lemmaId)).toEqual(ids.slice(150));
    // One statement per status: known, ignored, learning.
    expect(
      notes.statusCalls.filter((c) => c.userId === a.id).map((c) => c.lemmaIds.length),
    ).toEqual([120, 30, 50]);
    const rows = await statusRows(a.id as string);
    expect(rows.filter((r) => r.status === 'known')).toHaveLength(120);
    expect(rows.filter((r) => r.status === 'ignored')).toHaveLength(30);
    expect(rows.filter((r) => r.status === 'learning')).toHaveLength(50);
    expect(rows.every((r) => r.source === 'triage')).toBe(true);

    const again = await a.call('words.triage', { body: { decisions } });
    expect(again.body).toEqual({ updated: 200, notesCreated: 0 });
  });

  it('writes nothing when a step fails half way', async () => {
    const a = t.as();
    const decisions = Array.from({ length: 40 }, (_, i) => ({
      lemmaId: GENERATED_ID_BASE + 600 + i,
      decision: i < 10 ? ('known' as const) : ('learn' as const),
    }));
    notes.failAfter(10);
    const res = await a.call('words.triage', { body: { decisions } });
    notes.failAfter(null);
    expect(res.status).toBe(500);
    expect(await statusRows(a.id as string)).toEqual([]);
    const own = await db.db
      .select()
      .from(note)
      .where(eq(note.userId, a.id as string));
    expect(own).toEqual([]);
  });

  it('lets a later decision for the same word win and refuses unknown lemmas', async () => {
    const a = t.as();
    const res = await a.call('words.triage', {
      body: {
        decisions: [
          { lemmaId: 5, decision: 'learn' },
          { lemmaId: 5, decision: 'known' },
        ],
      },
    });
    expect(res.body).toEqual({ updated: 1, notesCreated: 0 });
    const bad = await a.call('words.triage', {
      body: { decisions: [{ lemmaId: 999_999, decision: 'known' }] },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.fields).toHaveProperty(['body.decisions.0.lemmaId']);
  });
});

describe('GET /lemmas/:id', () => {
  it('returns mesto with a table of six cases by two numbers', async () => {
    const a = t.as();
    const res = await a.call('lemmas.get', { params: { id: MESTO } });
    expect(res.status).toBe(200);
    const d = LemmaDetailSchema.parse(res.body);
    expect(d.lemma).toMatchObject({ id: MESTO, lemma: 'mesto', pos: 'noun', gender: 'n' });
    expect(d.senses.length).toBeGreaterThan(0);
    const cells = new Map<string, string[]>();
    for (const f of d.forms)
      for (const r of f.readings) {
        const key = `${r.case}.${r.number}`;
        cells.set(key, [...(cells.get(key) ?? []), f.form]);
      }
    const six = CASES.filter((c) => c !== 'voc');
    for (const c of six) for (const n of NUMBERS) expect(cells.get(`${c}.${n}`)).toBeDefined();
    expect(cells.get('loc.sg')).toEqual(['meste']);
    expect(cells.get('gen.pl')).toEqual(['miest']);
    expect(cells.get('ins.pl')).toEqual(['mestami']);
    expect(d.sentences.length).toBeGreaterThan(0);
    for (const s of d.sentences) expect(s.textSk.slice(s.span.start, s.span.end)).toBe(s.form);
    expect(d.status).toBe('unknown');
    expect(d.noteId).toBeNull();
  });

  it('shows the status and the note once the word is learned', async () => {
    const a = t.as();
    const put = await a.call('lemmas.setStatus', {
      params: { id: MESTO },
      body: { status: 'learning' },
    });
    expect(put.body).toEqual({ lemmaId: MESTO, status: 'learning' });
    const d = LemmaDetailSchema.parse((await a.call('lemmas.get', { params: { id: MESTO } })).body);
    expect(d.status).toBe('learning');
    const [row] = await db.db
      .select()
      .from(note)
      .where(and(eq(note.userId, a.id as string), eq(note.lemmaId, MESTO)));
    expect(d.noteId).toBe(row?.id);
  });

  it('answers every lemma of the mini dataset within the contract', async () => {
    const a = t.as();
    for (const id of Object.values(MINI_LEMMA_IDS)) {
      const res = await a.call('lemmas.get', { params: { id } });
      expect(res.status, `lemma ${id}`).toBe(200);
      endpoints['lemmas.get'].response.parse(res.body);
    }
  });

  it('answers not_found for an unknown lemma', async () => {
    const a = t.as();
    expect((await a.call('lemmas.get', { params: { id: 999_999 } })).body.error.code).toBe(
      'not_found',
    );
    const put = await a.call('lemmas.setStatus', {
      params: { id: 999_999 },
      body: { status: 'known' },
    });
    expect(put.status).toBe(404);
  });
});

describe('PUT /lemmas/:id/status', () => {
  it('sets known, ignored and unknown through NotesPort without a note', async () => {
    const a = t.as();
    const before = notes.notes.length;
    for (const status of ['known', 'ignored', 'unknown'] as const) {
      const res = await a.call('lemmas.setStatus', { params: { id: 11 }, body: { status } });
      expect(res.body).toEqual({ lemmaId: 11, status });
      const d = LemmaDetailSchema.parse((await a.call('lemmas.get', { params: { id: 11 } })).body);
      expect(d.status).toBe(status);
    }
    expect(notes.notes.length).toBe(before);
    expect(notes.statusOf(a.id as string, 11)).toBe('unknown');
  });
});

describe('isolation', () => {
  it("learner B sees none of learner A's statuses and notes", async () => {
    const a = t.as();
    const b = t.as();
    await a.call('words.triage', {
      body: {
        decisions: [
          { lemmaId: MESTO, decision: 'learn' },
          { lemmaId: 6, decision: 'known' },
        ],
      },
    });
    const bandsB = WordBandsSchema.parse((await b.call('words.bands')).body);
    expect(bandsB.bands.every((x) => x.known === 0 && x.learning === 0)).toBe(true);
    const listB = WordListSchema.parse(
      (await b.call('words.list', { query: { band: 0, status: 'known' } })).body,
    );
    expect(listB.items).toEqual([]);
    const pageB = LemmaDetailSchema.parse(
      (await b.call('lemmas.get', { params: { id: MESTO } })).body,
    );
    expect(pageB.status).toBe('unknown');
    expect(pageB.noteId).toBeNull();
    // B's own write does not touch A's row.
    await b.call('lemmas.setStatus', { params: { id: 6 }, body: { status: 'ignored' } });
    const pageA = LemmaDetailSchema.parse((await a.call('lemmas.get', { params: { id: 6 } })).body);
    expect(pageA.status).toBe('known');
  });
});

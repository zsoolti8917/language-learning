// The deck endpoints over a test database with the mini dataset: creation (word, phrase, case
// sentence), repeats, list, update, delete, the word note's sentences, and isolation.
import { type CreateNote, NoteDetailSchema, NoteListSchema } from '@app/contracts';
import { lemmaSentence, userLemma } from '@app/db';
import { uuidv7 } from '@app/testkit';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp, type TestClient } from '../../testing/app';
import { BRATA_CASE_SENTENCE, V_MESTE_PHRASE } from '../../testing/suites/notes';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const BYVAM = 'Bývam v meste.';
const wordBody = (id: string, lemmaId = 20): CreateNote => ({
  id,
  kind: 'word',
  source: 'reader',
  lemmaId,
  context: {
    sentenceSk: BYVAM,
    sentenceEn: 'I live in a town.',
    blank: { start: 8, end: 13 },
    tag: 's6',
  },
});

async function create(me: TestClient, body: CreateNote) {
  const res = await me.post('/notes', body);
  expect(res.status, res.text).toBe(200);
  return NoteDetailSchema.parse(res.body);
}

async function statusOf(userId: string, lemmaId: number) {
  const [row] = await t.db.db
    .select()
    .from(userLemma)
    .where(and(eq(userLemma.userId, userId), eq(userLemma.lemmaId, lemmaId)));
  return row;
}

describe('POST /notes', () => {
  it('creates a word note with sentences for the top forms and a card at once', async () => {
    const me = t.as();
    const id = uuidv7();
    const d = await create(me, wordBody(id));
    expect(d.note).toMatchObject({ id, kind: 'word', lemmaId: 20, source: 'reader' });
    const content = d.note.content;
    if (content.kind !== 'word') throw new Error('word');
    expect(content).toMatchObject({ lemma: 'mesto', glossEn: 'town, city' });
    expect(content.variants.length).toBeGreaterThan(0);
    expect(content.variants.length).toBeLessThanOrEqual(3);
    // The most used form (mesta, s2) comes first, from its Tatoeba sentence.
    expect(content.variants[0]).toMatchObject({
      sentenceId: 'tat-8214994',
      sentenceSk: 'Idem do mesta.',
      answer: 'mesta',
      tag: 's2',
    });
    // One sentence per form, each blank holding its answer.
    const answers = content.variants.map((v) => v.answer.toLowerCase());
    expect(new Set(answers).size).toBe(answers.length);
    for (const v of content.variants) {
      expect(v.sentenceSk.slice(v.blank.start, v.blank.end)).toBe(v.answer);
    }
    expect(d.card).toMatchObject({ state: 'new', reps: 0, dueAt: null, suspended: false });
    expect(d.card?.scheduler).toMatchObject({ v: 'fsrs7.1', state: 0 });
    expect(d.reviews).toEqual([]);
    expect(await statusOf(me.id as string, 20)).toMatchObject({
      status: 'learning',
      source: 'reader',
    });
  });

  it('returns the stored note for a repeated id, and the lemma note for a second id', async () => {
    const me = t.as();
    const id = uuidv7();
    const first = await create(me, wordBody(id));
    const again = await create(me, wordBody(id));
    expect(again).toEqual(first);
    const other = await create(me, { ...wordBody(uuidv7()), source: 'words' });
    expect(other.note.id).toBe(id);
  });

  it('answers 409 when the id names a note of another kind, 400 for an unknown lemma', async () => {
    const me = t.as();
    const id = uuidv7();
    await create(me, wordBody(id));
    const res = await me.post('/notes', {
      id,
      kind: 'phrase',
      source: 'reader',
      content: V_MESTE_PHRASE,
    });
    expect(res.status).toBe(409);
    const bad = await me.post('/notes', { ...wordBody(uuidv7()), lemmaId: 99999 });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.fields).toHaveProperty(['body.lemmaId']);
  });

  it('creates phrase and case sentence notes; one note per exercise', async () => {
    const me = t.as();
    const phrase = await create(me, {
      id: uuidv7(),
      kind: 'phrase',
      source: 'reader',
      content: V_MESTE_PHRASE,
    });
    expect(phrase.note.content).toEqual(V_MESTE_PHRASE);
    expect(phrase.card?.state).toBe('new');
    const first = await create(me, {
      id: uuidv7(),
      kind: 'case_sentence',
      source: 'manual',
      content: BRATA_CASE_SENTENCE,
    });
    expect(first.note).toMatchObject({ exerciseId: 'ex-140da36a9f', lemmaId: 3 });
    const second = await create(me, {
      id: uuidv7(),
      kind: 'case_sentence',
      source: 'manual',
      content: BRATA_CASE_SENTENCE,
    });
    expect(second.note.id).toBe(first.note.id);
  });

  it('falls back to the capture, then to the base form, when a lemma has no sentence', async () => {
    // Lemma 12 (kniha) loses its sentences in this test database only.
    await t.db.db.delete(lemmaSentence).where(eq(lemmaSentence.lemmaId, 12));
    const me = t.as();
    const capture = 'Čítam knihu.';
    const withCapture = await create(me, {
      id: uuidv7(),
      kind: 'word',
      source: 'reader',
      lemmaId: 12,
      context: { sentenceSk: capture, blank: { start: 6, end: 11 } },
    });
    expect(withCapture.note.content).toMatchObject({
      variants: [{ sentenceSk: capture, answer: 'knihu', tag: 's4', sentenceEn: '' }],
    });
    const other = t.as();
    const bare = await create(other, { id: uuidv7(), kind: 'word', source: 'words', lemmaId: 12 });
    expect(bare.note.content).toMatchObject({
      variants: [{ sentenceSk: 'kniha', answer: 'kniha', blank: { start: 0, end: 5 } }],
    });
    expect(await statusOf(other.id as string, 12)).toMatchObject({ source: 'triage' });
  });

  it('ignores a capture whose blank is not a form of the lemma', async () => {
    const me = t.as();
    const d = await create(me, {
      id: uuidv7(),
      kind: 'word',
      source: 'reader',
      lemmaId: 20,
      context: { sentenceSk: 'Mám psa.', blank: { start: 4, end: 7 } },
    });
    const content = d.note.content;
    if (content.kind !== 'word') throw new Error('word');
    expect(content.variants.some((v) => v.sentenceSk === 'Mám psa.')).toBe(false);
  });
});

describe('GET /notes', () => {
  it('lists live notes newest first, filters by kind and text, and pages', async () => {
    const me = t.as();
    for (const lemmaId of [20, 3, 12]) {
      t.clock.advance(1000);
      await create(me, { id: uuidv7(), kind: 'word', source: 'words', lemmaId });
    }
    t.clock.advance(1000);
    await create(me, { id: uuidv7(), kind: 'phrase', source: 'reader', content: V_MESTE_PHRASE });

    const all = NoteListSchema.parse((await me.get('/notes')).body);
    expect(all.items.map((i) => i.label)).toEqual(['v meste', 'kniha', 'brat', 'mesto']);
    expect(all.nextCursor).toBeNull();
    expect(all.items[1]).toMatchObject({
      kind: 'word',
      glossEn: 'book',
      state: 'new',
      dueAt: null,
    });

    const words = NoteListSchema.parse((await me.get('/notes?kind=word')).body);
    expect(words.items).toHaveLength(3);

    const found = NoteListSchema.parse((await me.get('/notes?q=MEST')).body);
    expect(found.items.map((i) => i.label).sort()).toEqual(['mesto', 'v meste']);

    const p1 = NoteListSchema.parse((await me.get('/notes?limit=3')).body);
    expect(p1.items).toHaveLength(3);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = NoteListSchema.parse((await me.get(`/notes?limit=3&cursor=${p1.nextCursor}`)).body);
    expect(p2.items.map((i) => i.label)).toEqual(['mesto']);
    expect(p2.nextCursor).toBeNull();

    const bad = await me.get('/notes?cursor=nonsense');
    expect(bad.status).toBe(400);
  });
});

describe('PATCH and DELETE /notes/:id', () => {
  it('suspends a note and its card, and changes content of the same kind only', async () => {
    const me = t.as();
    const id = uuidv7();
    await create(me, { id, kind: 'phrase', source: 'reader', content: V_MESTE_PHRASE });
    const res = await me.patch(`/notes/${id}`, { suspended: true });
    expect(res.status).toBe(200);
    const d = NoteDetailSchema.parse(res.body);
    expect(d.note.suspended).toBe(true);
    expect(d.card?.suspended).toBe(true);
    const queue = await me.get('/review/queue');
    expect(queue.body.items).toEqual([]);

    const changed = await me.patch(`/notes/${id}`, {
      content: { ...V_MESTE_PHRASE, glossEn: 'in the city' },
    });
    expect(changed.body.note.content.glossEn).toBe('in the city');
    const wrongKind = await me.patch(`/notes/${id}`, { content: BRATA_CASE_SENTENCE });
    expect(wrongKind.status).toBe(400);
  });

  it('marks a note deleted: it leaves the deck and the queue, a repeat is harmless', async () => {
    const me = t.as();
    const id = uuidv7();
    await create(me, wordBody(id));
    expect((await me.delete(`/notes/${id}`)).status).toBe(204);
    expect((await me.delete(`/notes/${id}`)).status).toBe(204);
    expect((await me.get(`/notes/${id}`)).status).toBe(404);
    expect((await me.patch(`/notes/${id}`, { suspended: true })).status).toBe(404);
    expect((await me.get('/notes')).body.items).toEqual([]);
    expect((await me.get('/review/queue')).body.items).toEqual([]);
    // The lemma can get a new word note.
    const again = await create(me, wordBody(uuidv7()));
    expect(again.note.id).not.toBe(id);
    expect((await me.delete(`/notes/${uuidv7()}`)).status).toBe(404);
  });
});

describe('isolation', () => {
  it('gives learner B not_found for learner A notes on every notes endpoint', async () => {
    const a = t.as();
    const b = t.as();
    const id = uuidv7();
    const mine = await create(a, wordBody(id));

    for (const [method, call] of [
      ['GET', () => b.get(`/notes/${id}`)],
      ['PATCH', () => b.patch(`/notes/${id}`, { suspended: true })],
      ['DELETE', () => b.delete(`/notes/${id}`)],
    ] as const) {
      const res = await call();
      expect(res.status, method).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    }
    expect((await b.get('/notes')).body.items).toEqual([]);
    // B cannot take A's id; A's note is unchanged.
    const taken = await b.post('/notes', {
      id,
      kind: 'phrase',
      source: 'reader',
      content: V_MESTE_PHRASE,
    });
    expect(taken.status).toBe(409);
    const after = await a.get(`/notes/${id}`);
    expect(NoteDetailSchema.parse(after.body)).toEqual(mine);
    // B's own word note for the same lemma is a note of B's.
    const own = await create(b, wordBody(uuidv7()));
    expect(own.note.id).not.toBe(id);
  });
});

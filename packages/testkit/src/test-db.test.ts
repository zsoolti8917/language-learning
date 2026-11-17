import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appText, card, note, profile, queryRows } from '@app/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MESTO_WORD_CONTENT } from './factories';
import { createTestDb, MINI_CONTENT_DIR, type TestDb } from './test-db';
import { uuidv7 } from './uuid';

let t: TestDb;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'testkit-content-'));
  writeFileSync(
    join(dir, 'lemmas.jsonl'),
    `${JSON.stringify({ id: 20, key: 'mesto|noun|n|1', lemma: 'mesto', pos: 'noun', gender: 'n' })}\n`,
  );
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      version: '2026-12-01.1',
      builtAt: '2026-12-01T06:00:00.000Z',
      sources: [],
      counts: { lemmas: 1 },
    }),
  );
  t = await createTestDb({ content: dir });
}, 60_000);
afterAll(async () => {
  await t?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('createTestDb', () => {
  it('applies the migrations, installs auth.uid() and loads the content folder', async () => {
    expect(t.content?.rows.lemmas).toBe(1);
    const [r] = await queryRows<{ n: number; uid: string | null }>(
      t.db,
      sql`select (select count(*)::int from ling.lemma) as n, auth.uid()::text as uid`,
    );
    expect(r).toEqual({ n: 1, uid: null });
  });

  it("resolves 'mini' to the folder of the mini dataset", () => {
    expect(MINI_CONTENT_DIR).toMatch(/packages[\\/]testkit[\\/]mini$/);
  });

  it.skipIf(!existsSync(join(MINI_CONTENT_DIR, 'manifest.json')))(
    'loads the mini dataset',
    async () => {
      const mini = await createTestDb({ content: 'mini' });
      try {
        expect(mini.content?.rows.lemmas).toBe(72);
      } finally {
        await mini.close();
      }
    },
    60_000,
  );
});

describe('factories', () => {
  it('make valid rows with parents and accept overrides', async () => {
    const r = await t.factory.review();
    const [c] = await t.db.select().from(card).where(eq(card.id, r.cardId));
    const [n] = await t.db
      .select()
      .from(note)
      .where(eq(note.id, c?.noteId ?? ''));
    expect(c?.userId).toBe(r.userId);
    expect(n?.userId).toBe(r.userId);
    expect(n?.kind).toBe('phrase');

    const user = await t.factory.profile({ dailyNewLimit: 5 });
    expect(user.dailyNewLimit).toBe(5);
    const word = await t.factory.note({ userId: user.userId, content: MESTO_WORD_CONTENT });
    expect(word).toMatchObject({ kind: 'word', lemmaId: 20 });
    const text = await t.factory.text({ userId: user.userId, title: 'Moja' });
    expect(text.status).toBe('processing');
    const conv = await t.factory.conversation({ userId: user.userId });
    const err = await t.factory.tutorError({ userId: user.userId, conversationId: conv.id });
    expect(err.conversationId).toBe(conv.id);
    // Two default notes and cards for one learner do not collide.
    await t.factory.card({ userId: user.userId });
    await t.factory.card({ userId: user.userId });
  });

  it('rows are visible to their owner through withUser', async () => {
    const id = uuidv7();
    await t.factory.text({ userId: (await t.factory.profile({ userId: id })).userId });
    const seen = await t.withUser(id, (tx) => tx.select().from(appText));
    expect(seen).toHaveLength(1);
  });

  it('resetApp removes every learner row', async () => {
    await t.factory.attempt();
    await t.resetApp();
    expect(await t.db.select().from(profile)).toEqual([]);
    const [r] = await queryRows<{ n: number }>(
      t.db,
      sql`select count(*)::int as n from app.attempt`,
    );
    expect(r?.n).toBe(0);
  });
});

describe('uuidv7', () => {
  it('makes ordered version 7 ids', () => {
    const ids = Array.from({ length: 50 }, () => uuidv7());
    for (const id of ids)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect([...ids].sort()).toEqual(ids);
  });
});

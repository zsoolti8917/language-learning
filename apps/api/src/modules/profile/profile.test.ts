// B7: GET/PATCH/DELETE /me and GET /me/export over the real app, one test database per file.
import { ExportSchema, ProfileSchema } from '@app/contracts';
import { queryRows } from '@app/db';
import { createTestDb, FACTORY_FOR_TABLE, type TestDb, uuidv7 } from '@app/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TokenVerifier } from '../../platform/auth';
import { createTestApp, type TestApp } from '../../testing/app';
import { EXPORT_TABLES } from './repo';
import { deleteLogin } from './service';

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
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Every table of schema `app`, from the catalog. */
async function appTables(): Promise<string[]> {
  const rows = await queryRows<{ table_name: string }>(
    db.db,
    sql`select table_name from information_schema.tables
        where table_schema = 'app' and table_type = 'BASE TABLE' order by table_name`,
  );
  return rows.map((r) => r.table_name);
}

/** Rows of `userId` in each table of schema `app` (as the owner, RLS bypassed). */
async function rowsPerTable(userId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of await appTables()) {
    const [row] = await queryRows<{ n: unknown }>(
      db.db,
      sql`select count(*) as n from ${sql.identifier('app')}.${sql.identifier(table)}
          where user_id = ${userId}::uuid`,
    );
    out[table] = Number(row?.n ?? 0);
  }
  return out;
}

/** One row (at least) in every table of schema `app` for this learner. */
async function seedEverything(userId: string): Promise<Record<string, string>> {
  const f = db.factory;
  await f.profile({ userId });
  const ids: Record<string, string> = {};
  ids.userLemma = String((await f.userLemma({ userId })).lemmaId);
  const n = await f.note({ userId });
  ids.note = n.id;
  const c = await f.card({ userId, noteId: n.id });
  ids.card = c.id;
  ids.review = (await f.review({ userId, cardId: c.id })).id;
  ids.attempt = (await f.attempt({ userId })).id;
  ids.lessonProgress = (await f.lessonProgress({ userId })).lessonId;
  ids.text = (await f.text({ userId })).id;
  const conv = await f.conversation({ userId });
  ids.conversation = conv.id;
  const m = await f.message({ userId, conversationId: conv.id });
  ids.message = m.id;
  ids.tutorError = (await f.tutorError({ userId, conversationId: conv.id, messageId: m.id })).id;
  ids.placement = (await f.placement({ userId })).id;
  ids.aiCall = (await f.aiCall({ userId })).id;
  ids.contentReport = (await f.contentReport({ userId })).id;
  return ids;
}

describe('GET /me', () => {
  it('creates the profile with the defaults on the first call', async () => {
    const me = t.as();
    const res = await me.get('/me');
    expect(res.status).toBe(200);
    const p = ProfileSchema.parse(res.body);
    expect(p).toMatchObject({
      userId: me.id,
      displayName: null,
      timezone: 'Europe/Bratislava',
      dayStartHour: 4,
      dailyNewLimit: 10,
      dailyReviewLimit: 80,
      desiredRetention: 0.9,
      strictDiacritics: false,
      wordsBandTarget: 1000,
      settings: {},
      placementDoneAt: null,
      currentLessonId: null,
    });
  });
});

describe('PATCH /me', () => {
  it('changes only the fields sent and stamps updatedAt with the server clock', async () => {
    const me = t.as();
    await me.get('/me');
    t.clock.set('2026-11-17T10:00:00.000Z');
    const res = await me.patch('/me', {
      displayName: 'Zsolt',
      timezone: 'America/New_York',
      dailyNewLimit: 15,
      dailyReviewLimit: 120,
      desiredRetention: 0.85,
      strictDiacritics: true,
      settings: { theme: 'dark', minutesPerDay: 15 },
    });
    expect(res.status).toBe(200);
    const p = ProfileSchema.parse(res.body);
    expect(p).toMatchObject({
      displayName: 'Zsolt',
      timezone: 'America/New_York',
      dayStartHour: 4,
      dailyNewLimit: 15,
      dailyReviewLimit: 120,
      desiredRetention: 0.85,
      strictDiacritics: true,
      settings: { theme: 'dark', minutesPerDay: 15 },
      updatedAt: '2026-11-17T10:00:00.000Z',
    });
    expect((await me.get('/me')).body).toEqual(p);
    t.clock.set('2026-11-17T08:30:00.000Z');
  });

  it('refuses an unknown time zone name', async () => {
    const me = t.as();
    const res = await me.patch('/me', { timezone: 'Europe/Atlantis' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(res.body.error.details.fields).toHaveProperty('body.timezone');
    expect((await me.get('/me')).body.timezone).toBe('Europe/Bratislava');
  });

  it.each([
    [{ dailyNewLimit: -1 }, 'body.dailyNewLimit'],
    [{ dailyNewLimit: 1001 }, 'body.dailyNewLimit'],
    [{ dailyReviewLimit: 10_001 }, 'body.dailyReviewLimit'],
    [{ dailyReviewLimit: 2.5 }, 'body.dailyReviewLimit'],
    [{ dayStartHour: 24 }, 'body.dayStartHour'],
    [{ desiredRetention: 0.5 }, 'body.desiredRetention'],
    [{ desiredRetention: 1 }, 'body.desiredRetention'],
    [{ wordsBandTarget: 0 }, 'body.wordsBandTarget'],
  ])('refuses %j', async (body, field) => {
    const res = await t.as().patch('/me', body);
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields).toHaveProperty(field);
  });

  it('accepts the edges of the ranges', async () => {
    const res = await t.as().patch('/me', {
      dailyNewLimit: 0,
      dailyReviewLimit: 10_000,
      dayStartHour: 23,
      desiredRetention: 0.99,
      timezone: 'UTC',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      dailyNewLimit: 0,
      dailyReviewLimit: 10_000,
      dayStartHour: 23,
    });
  });

  it('an empty body changes nothing', async () => {
    const me = t.as();
    const before = (await me.get('/me')).body;
    const res = await me.patch('/me', {});
    expect(res.status).toBe(200);
    expect(res.body).toEqual(before);
  });
});

describe('GET /me/export', () => {
  it('holds rows from every learner table for that learner and nothing of another', async () => {
    const a = uuidv7();
    const b = uuidv7();
    const idsA = await seedEverything(a);
    const idsB = await seedEverything(b);

    // The export covers every table of schema app.
    const tables = await appTables();
    const exported = Object.keys(EXPORT_TABLES);
    expect(exported.length).toBe(tables.length - 1);
    for (const table of tables) {
      if (table === 'profile') continue;
      expect(exported).toContain(FACTORY_FOR_TABLE[table as keyof typeof FACTORY_FOR_TABLE]);
    }

    const res = await t.as(a).get('/me/export');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename=".+\.json"/);
    const ex = ExportSchema.parse(res.body);
    expect(ex.profile.userId).toBe(a);
    expect(ex.exportedAt).toBe('2026-11-17T08:30:00.000Z');
    for (const name of exported) {
      const rows = ex.tables[name] ?? [];
      expect(rows.length, name).toBeGreaterThan(0);
      const key = name === 'userLemma' ? 'lemmaId' : name === 'lessonProgress' ? 'lessonId' : 'id';
      expect(
        rows.map((r) => String(r[key])),
        name,
      ).toContain(idsA[name]);
      if (key === 'id')
        expect(
          rows.map((r) => r.id),
          name,
        ).not.toContain(idsB[name]);
    }
    // Nothing of learner B anywhere in the file.
    expect(res.text).not.toContain(b);
    for (const [name, id] of Object.entries(idsB)) {
      if (name === 'userLemma' || name === 'lessonProgress') continue;
      expect(res.text).not.toContain(id);
    }
    // Rows are camelCase with ISO timestamps.
    const reviewRow = ex.tables.review?.[0] ?? {};
    expect(reviewRow).toHaveProperty('answeredAt');
    expect(String(reviewRow.answeredAt)).toMatch(/Z$/);
    expect(reviewRow).not.toHaveProperty('userId');
  });

  it('a fresh learner exports a profile and empty tables', async () => {
    const res = await t.as().get('/me/export');
    const ex = ExportSchema.parse(res.body);
    for (const name of Object.keys(EXPORT_TABLES)) expect(ex.tables[name]).toEqual([]);
  });
});

describe('DELETE /me', () => {
  it('in dev mode removes every row of the learner in schema app, and only the rows', async () => {
    const a = uuidv7();
    const b = uuidv7();
    await seedEverything(a);
    await seedEverything(b);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const before = await rowsPerTable(a);
    for (const [table, n] of Object.entries(before)) expect(n, table).toBeGreaterThan(0);

    const res = await t.as(a).delete('/me');
    expect(res.status).toBe(204);
    expect(res.text).toBe('');

    const after = await rowsPerTable(a);
    for (const [table, n] of Object.entries(after)) expect(n, table).toBe(0);
    // The other learner keeps everything.
    for (const [table, n] of Object.entries(await rowsPerTable(b)))
      expect(n, table).toBe(before[table]);
    // No login service in dev mode.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('the next call starts a fresh profile', async () => {
    const me = t.as();
    await me.patch('/me', { displayName: 'Old' });
    expect((await me.delete('/me')).status).toBe(204);
    const res = await me.get('/me');
    expect(res.status).toBe(200);
    expect(res.body.displayName).toBeNull();
  });
});

describe('DELETE /me in Supabase mode', () => {
  const SUPABASE = {
    authMode: 'supabase' as const,
    supabaseUrl: 'https://project.supabase.test',
    supabaseSecretKey: 'sb_secret_test',
  };
  // Accepts the dev token shape, but reports Supabase mode.
  const auth: TokenVerifier = {
    mode: 'supabase',
    verify: async (token) => token.replace(/^dev:/, ''),
  };
  let s: TestApp;
  beforeAll(async () => {
    s = await createTestApp({ db, config: SUPABASE, auth });
  });
  afterAll(async () => {
    await s.close();
  });

  it('deletes the rows first, then the login through the admin interface', async () => {
    const a = uuidv7();
    await seedEverything(a);
    const seen: { url: string; method: string; headers: Headers; rowsLeft: number }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const left = Object.values(await rowsPerTable(a)).reduce((x, y) => x + y, 0);
      seen.push({
        url: String(url),
        method: String(init.method),
        headers: new Headers(init.headers),
        rowsLeft: left,
      });
      return new Response('{}', { status: 200 });
    });
    const res = await s.as(a).delete('/me');
    expect(res.status).toBe(204);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(`https://project.supabase.test/auth/v1/admin/users/${a}`);
    expect(seen[0]?.method).toBe('DELETE');
    expect(seen[0]?.headers.get('apikey')).toBe('sb_secret_test');
    expect(seen[0]?.headers.get('authorization')).toBe('Bearer sb_secret_test');
    // The rows were gone (and the transaction closed) when the login service was called.
    expect(seen[0]?.rowsLeft).toBe(0);
  });

  it('a login that is already gone counts as deleted', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"msg":"User not found"}', { status: 404 }));
    expect((await s.as().delete('/me')).status).toBe(204);
  });

  it('a failing login service answers 502 upstream_failed, and a retry works', async () => {
    const a = uuidv7();
    vi.stubGlobal('fetch', async () => new Response('boom', { status: 500 }));
    const res = await s.as(a).delete('/me');
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('upstream_failed');
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    expect((await s.as(a).delete('/me')).status).toBe(502);
    vi.stubGlobal('fetch', async () => new Response(null, { status: 200 }));
    expect((await s.as(a).delete('/me')).status).toBe(204);
  });

  it('without a secret key nothing is deleted', async () => {
    const n = await createTestApp({
      db,
      config: { ...SUPABASE, supabaseSecretKey: null },
      auth,
    });
    const a = uuidv7();
    await seedEverything(a);
    const res = await n.as(a).delete('/me');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('internal');
    expect((await rowsPerTable(a)).note).toBeGreaterThan(0);
    await n.close();
  });

  it('deleteLogin does nothing in dev mode', async () => {
    const f = vi.fn();
    await deleteLogin(t.deps.config, uuidv7(), f);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('isolation', () => {
  it("learner B never sees or changes learner A's rows through the profile endpoints", async () => {
    const a = uuidv7();
    const idsA = await seedEverything(a);
    await t.as(a).patch('/me', { displayName: 'Learner A' });
    const b = t.as();

    const me = await b.get('/me');
    expect(me.body.userId).toBe(b.id);
    expect(me.body.displayName).toBeNull();

    await b.patch('/me', { displayName: 'Learner B' });
    expect((await t.as(a).get('/me')).body.displayName).toBe('Learner A');

    const ex = await b.get('/me/export');
    expect(ex.text).not.toContain(a);
    for (const id of Object.values(idsA)) if (id.length > 10) expect(ex.text).not.toContain(id);

    const today = await b.get('/today');
    expect(today.body.continueText).toBeNull();
    expect(today.body.review).toEqual({ due: 0, new: 0, learning: 0 });
    const stats = await b.get('/stats/summary');
    expect(stats.body.words).toEqual({ known: 0, learning: 0 });

    const before = await rowsPerTable(a);
    expect((await b.delete('/me')).status).toBe(204);
    expect(await rowsPerTable(a)).toEqual(before);
  });
});

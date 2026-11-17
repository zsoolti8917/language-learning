import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Database, queryRows } from './client';
import { lemma, note, profile, sense } from './schema';
import { freshDb, USER_A, USER_B } from './testing/fresh-db';

let database: Database;
let appTables: string[];

beforeAll(async () => {
  database = await freshDb();
  await database.db.insert(profile).values([{ userId: USER_A }, { userId: USER_B }]);
  await database.db.insert(lemma).values({
    id: 20,
    key: 'mesto|noun|n|1',
    lemma: 'mesto',
    lemmaAscii: 'mesto',
    pos: 'noun',
    gender: 'n',
  });
  appTables = (
    await queryRows<{ name: string }>(
      database.db,
      sql`select tablename as name from pg_tables where schemaname = 'app' order by 1`,
    )
  ).map((r) => r.name);
}, 60_000);
afterAll(async () => {
  await database?.close();
});

function errorText(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  while (cur instanceof Error) {
    parts.push(cur.message);
    cur = (cur as { cause?: unknown }).cause;
  }
  return parts.join(' | ');
}

async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return errorText(e);
  }
  throw new Error('expected a failure');
}

describe('the role app_api', () => {
  it('owns nothing, cannot bypass row level security, and inherits nothing', async () => {
    const [r] = await queryRows<{
      super: boolean;
      bypass: boolean;
      inherit: boolean;
      owned: number;
      can_set: boolean;
      uses: boolean;
    }>(
      database.db,
      sql`select r.rolsuper as super, r.rolbypassrls as bypass, r.rolinherit as inherit,
            (select count(*)::int from pg_class c where c.relowner = r.oid) as owned,
            pg_has_role('app_api', 'authenticated', 'MEMBER') as can_set,
            pg_has_role('app_api', 'authenticated', 'USAGE') as uses
          from pg_roles r where r.rolname = 'app_api'`,
    );
    expect(r).toEqual({
      super: false,
      bypass: false,
      inherit: false,
      owned: 0,
      can_set: true,
      uses: false,
    });
  });

  it('reads nothing from schema app without the role switch', async () => {
    expect(appTables).toHaveLength(14);
    for (const name of appTables) {
      const err = await failure(
        database.withSystem((tx) => tx.execute(sql.raw(`select * from app."${name}"`))),
      );
      expect(err, name).toMatch(/permission denied/);
    }
    const [priv] = await queryRows<{ any: boolean }>(
      database.db,
      sql`select bool_or(has_table_privilege('app_api', format('app.%I', tablename),
            'select,insert,update,delete')) as any
          from pg_tables where schemaname = 'app'`,
    );
    expect(priv?.any).toBe(false);
  });

  it('reads schema ling and stores glosses, but changes nothing else there', async () => {
    const rows = await database.withSystem((tx) => tx.select().from(lemma));
    expect(rows.map((r) => r.lemma)).toEqual(['mesto']);
    await database.withSystem((tx) =>
      tx.insert(sense).values({ lemmaId: 20, ord: 0, glossEn: 'town', source: 'runtime' }),
    );
    const err = await failure(
      database.withSystem((tx) => tx.update(lemma).set({ lemma: 'x' }).where(eq(lemma.id, 20))),
    );
    expect(err).toMatch(/permission denied/);
  });
});

describe('withUser', () => {
  it('switches to authenticated with the learner as auth.uid(), for this transaction only', async () => {
    const inside = await database.withUser(USER_A, async (tx) =>
      queryRows<{ role: string; uid: string }>(
        tx,
        sql`select current_user as role, auth.uid()::text as uid`,
      ),
    );
    expect(inside).toEqual([{ role: 'authenticated', uid: USER_A }]);
    const after = await queryRows<{ role: string; uid: string | null }>(
      database.db,
      sql`select current_user as role, auth.uid()::text as uid`,
    );
    expect(after).toEqual([{ role: 'postgres', uid: null }]);
  });

  it('sees only the learner rows and may read ling, not write it', async () => {
    const seen = await database.withUser(USER_A, (tx) => tx.select().from(profile));
    expect(seen.map((p) => p.userId)).toEqual([USER_A]);
    const lemmas = await database.withUser(USER_B, (tx) => tx.select().from(lemma));
    expect(lemmas).toHaveLength(1);
    const err = await failure(
      database.withUser(USER_B, (tx) =>
        tx.insert(sense).values({ lemmaId: 20, ord: 5, glossEn: 'x', source: 'runtime' }),
      ),
    );
    expect(err).toMatch(/permission denied/);
  });

  it('rolls back on error and refuses an id that is not a uuid', async () => {
    const id = '0190a000-0000-7000-8000-0000000000ff';
    await failure(
      database.withUser(USER_A, async (tx) => {
        await tx.insert(note).values({
          id,
          userId: USER_A,
          kind: 'phrase',
          source: 'manual',
          content: {
            kind: 'phrase',
            textSk: 'v meste',
            glossEn: 'in town',
            context: { sentenceSk: 'Bývam v meste.', sentenceEn: '', blank: { start: 6, end: 13 } },
          },
        });
        throw new Error('boom');
      }),
    );
    expect(await database.db.select().from(note).where(eq(note.id, id))).toEqual([]);
    expect(() => database.withUser("x'; drop table app.note; --", async () => 1)).toThrow(
      /not a uuid/,
    );
  });

  it('check constraints hold enum columns to the contract values', async () => {
    const err = await failure(
      database.db.insert(note).values({
        id: '0190a000-0000-7000-8000-0000000000fe',
        userId: USER_A,
        kind: 'sentence',
        source: 'manual',
        content: { kind: 'phrase' } as never,
      }),
    );
    expect(err).toMatch(/note_kind_check/);
  });
});

describe('createDb', () => {
  it('makes a postgres.js client lazily, without connecting', async () => {
    const pg = createDb({ mode: 'postgres', url: 'postgres://app_api@127.0.0.1:1/none' });
    expect(pg.mode).toBe('postgres');
    expect(pg.pglite).toBeNull();
    await pg.close();
  });
});

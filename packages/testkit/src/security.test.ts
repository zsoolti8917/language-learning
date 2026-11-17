// Row level security of schema `app`, read from the catalog: every table found there
// must have user_id, forced row level security and owner policies, and must keep two
// learners apart. A new table without a factory fails here too.
import { APPEND_ONLY_TABLES, queryRows, type Tx } from '@app/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FACTORY_FOR_TABLE } from './factories';
import { createTestDb, type TestDb } from './test-db';
import { uuidv7 } from './uuid';

let t: TestDb;
let tables: CatalogRow[];
const A = uuidv7();
const B = uuidv7();

type CatalogRow = {
  name: string;
  rls: boolean;
  forced: boolean;
  has_user_id: boolean;
  user_id_not_null: boolean;
  policies: number;
};

beforeAll(async () => {
  t = await createTestDb();
  tables = await queryRows<CatalogRow>(
    t.db,
    sql`select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
          exists (select 1 from pg_attribute a where a.attrelid = c.oid
                  and a.attname = 'user_id' and not a.attisdropped) as has_user_id,
          exists (select 1 from pg_attribute a where a.attrelid = c.oid
                  and a.attname = 'user_id' and a.attnotnull) as user_id_not_null,
          (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'app' and c.relkind in ('r', 'p')
        order by c.relname`,
  );
  await t.factory.profile({ userId: A });
  await t.factory.profile({ userId: B });
  for (const user of [A, B])
    for (const { name } of tables) {
      if (name === 'profile') continue;
      const factory = FACTORY_FOR_TABLE[name as keyof typeof FACTORY_FOR_TABLE];
      if (factory) await t.factory[factory]({ userId: user });
    }
}, 60_000);

afterAll(async () => {
  await t?.close();
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

const ident = (name: string) => sql.raw(`app."${name}"`);

/** Runs fn as user A and returns its error text, or null when it succeeded. */
async function asAFails(fn: (tx: Tx) => Promise<unknown>): Promise<string | null> {
  try {
    await t.withUser(A, fn);
    return null;
  } catch (e) {
    return errorText(e);
  }
}

describe('the catalog of schema app', () => {
  it('lists the 14 learner tables', () => {
    expect(tables.map((r) => r.name)).toHaveLength(14);
  });

  it('every table has user_id, forced row level security and a policy', () => {
    const bad = tables.filter(
      (r) => !r.has_user_id || !r.user_id_not_null || !r.rls || !r.forced || r.policies === 0,
    );
    expect(bad).toEqual([]);
  });

  it('every policy is for authenticated and compares user_id with auth.uid()', async () => {
    const policies = await queryRows<{
      tablename: string;
      cmd: string;
      roles: string[] | string;
      qual: string | null;
      with_check: string | null;
    }>(
      t.db,
      sql`select tablename, cmd, roles, qual, with_check from pg_policies where schemaname = 'app'`,
    );
    for (const p of policies) {
      const roles = Array.isArray(p.roles)
        ? p.roles
        : String(p.roles).replace(/[{}]/g, '').split(',');
      expect(roles, p.tablename).toEqual(['authenticated']);
      for (const expr of [p.qual, p.with_check].filter((x): x is string => x !== null))
        expect(expr.replace(/\s+/g, ' '), `${p.tablename} ${p.cmd}`).toMatch(
          /^\(user_id = \( SELECT auth\.uid\(\) AS uid\)\)$/,
        );
    }
    for (const { name } of tables) {
      const cmds = policies
        .filter((p) => p.tablename === name)
        .map((p) => p.cmd)
        .sort();
      const appendOnly = (APPEND_ONLY_TABLES as readonly string[]).includes(name);
      expect(cmds, name).toEqual(
        appendOnly ? ['DELETE', 'INSERT', 'SELECT'] : ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
      );
    }
  });

  it('has a factory for every table, so the isolation tests cover all of them', () => {
    expect(tables.map((r) => r.name).filter((n) => !(n in FACTORY_FOR_TABLE))).toEqual([]);
  });
});

describe('isolation between two learners', () => {
  // The table names come from the catalog at run time; each test loops over all of them.
  it('A sees its own rows and none of B', async () => {
    for (const { name } of tables) {
      const [mine, theirs] = await t.withUser(A, async (tx) => [
        (await queryRows<{ n: number }>(tx, sql`select count(*)::int as n from ${ident(name)}`))[0]
          ?.n,
        (
          await queryRows<{ n: number }>(
            tx,
            sql`select count(*)::int as n from ${ident(name)} where user_id = ${B}`,
          )
        )[0]?.n,
      ]);
      expect(theirs, name).toBe(0);
      expect(mine, name).toBeGreaterThan(0);
    }
  });

  it('A cannot update B rows, nor hand its own rows to B', async () => {
    for (const { name } of tables) {
      const appendOnly = (APPEND_ONLY_TABLES as readonly string[]).includes(name);
      const err = await asAFails(async (tx) => {
        const rows = await queryRows(
          tx,
          sql`update ${ident(name)} set user_id = user_id where user_id = ${B} returning 1`,
        );
        expect(rows, name).toHaveLength(0);
      });
      if (appendOnly) expect(err, name).toMatch(/permission denied/);
      else expect(err, name).toBeNull();

      const move = await asAFails((tx) =>
        tx.execute(sql`update ${ident(name)} set user_id = ${B} where user_id = ${A}`),
      );
      expect(move, name).toMatch(appendOnly ? /permission denied/ : /row-level security/);
    }
  });

  it('A cannot delete B rows', async () => {
    for (const { name } of tables) {
      const deleted = await t.withUser(A, (tx) =>
        queryRows(tx, sql`delete from ${ident(name)} where user_id = ${B} returning 1`),
      );
      expect(deleted, name).toHaveLength(0);
      const [left] = await queryRows<{ n: number }>(
        t.db,
        sql`select count(*)::int as n from ${ident(name)} where user_id = ${B}`,
      );
      expect(left?.n, name).toBeGreaterThan(0);
    }
  });

  it('A cannot insert rows for B', async () => {
    for (const { name } of tables) {
      const [row] = await queryRows<{ j: Record<string, unknown> }>(
        t.db,
        sql`select to_jsonb(x) as j from ${ident(name)} x where user_id = ${B} limit 1`,
      );
      const copy = { ...row?.j };
      if ('id' in copy) copy.id = uuidv7();
      const err = await asAFails((tx) =>
        tx.execute(
          sql`insert into ${ident(name)} select * from jsonb_populate_record(null::${ident(name)}, ${JSON.stringify(copy)}::jsonb)`,
        ),
      );
      expect(err, name).toMatch(/row-level security/);
    }
  });

  it('A can still insert, update and delete its own rows', async () => {
    const rollback = new Error('rollback');
    for (const { name } of tables) {
      const appendOnly = (APPEND_ONLY_TABLES as readonly string[]).includes(name);
      const err = await asAFails(async (tx) => {
        const [row] = await queryRows<{ j: Record<string, unknown> }>(
          tx,
          sql`select to_jsonb(x) as j from ${ident(name)} x where user_id = ${A} limit 1`,
        );
        if (!appendOnly) {
          const updated = await queryRows(
            tx,
            sql`update ${ident(name)} set user_id = user_id where user_id = ${A} returning 1`,
          );
          expect(updated.length, name).toBeGreaterThan(0);
        }
        await tx.execute(sql`delete from ${ident(name)} where user_id = ${A}`);
        await tx.execute(
          sql`insert into ${ident(name)} select * from jsonb_populate_record(null::${ident(name)}, ${JSON.stringify(row?.j)}::jsonb)`,
        );
        throw rollback;
      });
      expect(err, name).toBe('rollback');
    }
  });
});

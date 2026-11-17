// Drift check for this package's tests: drizzle-kit introspects a migrated database
// (`drizzle-kit pull`), and the result is compared with the snapshot drizzle-kit makes
// from the TypeScript schema. Postgres rewrites the text of check, index and policy
// expressions, so those are compared by name and shape, everything else in full.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '../client';
import { migrate } from '../migrate';
import * as schema from '../schema';

type Json = Record<string, unknown>;
type Snapshot = { tables: Record<string, Json> };

const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));

const sorted = <T>(xs: T[]) =>
  [...xs].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const values = (o: unknown) => Object.values((o ?? {}) as Record<string, Json>);
// Casts and quoting of defaults differ between the two sides ('{}'::text[] vs '{""}').
const normDefault = (d: unknown) =>
  d === undefined
    ? null
    : String(d)
        .replace(/::[a-z[\]\s]+$/iu, '')
        .replaceAll(/['"]/gu, '');

/** The shape of a snapshot that survives a round trip through Postgres. */
export function shapeOf(snapshot: Snapshot): Json {
  const out: Json = {};
  for (const [key, t] of Object.entries(snapshot.tables)) {
    out[key] = {
      columns: sorted(
        values(t.columns).map((c) => ({
          name: c.name,
          type: c.type,
          primaryKey: c.primaryKey,
          notNull: c.notNull,
          default: normDefault(c.default),
          identity: (c.identity as Json | undefined)?.type ?? null,
        })),
      ),
      // drizzle-kit pull lists key columns sorted by name.
      primaryKeys: sorted(
        values(t.compositePrimaryKeys).map((p) => [p.name, [...(p.columns as string[])].sort()]),
      ),
      foreignKeys: sorted(
        values(t.foreignKeys).map((f) => [
          f.name,
          f.schemaTo,
          f.tableTo,
          f.columnsFrom,
          f.columnsTo,
          f.onDelete,
        ]),
      ),
      uniques: sorted(
        values(t.uniqueConstraints).map((u) => [u.name, [...(u.columns as string[])].sort()]),
      ),
      checks: sorted(values(t.checkConstraints).map((c) => c.name)),
      indexes: sorted(
        values(t.indexes).map((i) => [
          i.name,
          i.isUnique,
          (i.columns as Json[]).map((c) => c.expression),
          Boolean(i.where),
        ]),
      ),
      // drizzle-kit pull drops some policy expressions, so expressions are checked against
      // pg_policies in security.test.ts instead.
      policies: sorted(values(t.policies).map((p) => [p.name, p.as, p.for, p.to])),
      // A table with policies gets row level security from drizzle-kit implicitly.
      rls: Boolean(t.isRLSEnabled) || values(t.policies).length > 0,
    };
  }
  return out;
}

/** Migrates a fresh PGlite on disk, runs `drizzle-kit pull` on it, returns both shapes. */
export async function pullAndCompare(): Promise<{ database: Json; schema: Json }> {
  const dir = mkdtempSync(join(tmpdir(), 'f3-drift-'));
  try {
    const dataDir = join(dir, 'pgdata');
    const db = createDb({ mode: 'pglite', dataDir });
    await migrate(db);
    await db.close();
    const config = join(dir, 'drizzle.config.mjs');
    writeFileSync(
      config,
      `export default ${JSON.stringify({
        dialect: 'postgresql',
        driver: 'pglite',
        dbCredentials: { url: dataDir },
        out: join(dir, 'out'),
        schemaFilter: ['app', 'ling'],
      })};\n`,
    );
    const bin = join(PACKAGE_DIR, 'node_modules', '.bin', 'drizzle-kit');
    const r = spawnSync(bin, ['pull', '--config', config], {
      cwd: PACKAGE_DIR,
      encoding: 'utf8',
      timeout: 120_000,
    });
    if (r.status !== 0) throw new Error(`drizzle-kit pull failed:\n${r.stdout}\n${r.stderr}`);
    const pulled = JSON.parse(
      readFileSync(join(dir, 'out', 'meta', '0000_snapshot.json'), 'utf8'),
    ) as Snapshot;
    const { generateDrizzleJson } = await import('drizzle-kit/api');
    const current = generateDrizzleJson(schema, undefined, ['app', 'ling']) as unknown as Snapshot;
    return { database: shapeOf(pulled), schema: shapeOf(current) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

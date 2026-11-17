import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Database, queryRows } from './client';
import { MIGRATIONS_FOLDER } from './migrate';
import * as schema from './schema';
import { pullAndCompare } from './testing/drift';
import { freshDb } from './testing/fresh-db';

let database: Database;

beforeAll(async () => {
  database = await freshDb();
}, 60_000);
afterAll(async () => {
  await database?.close();
});

async function tables(schemaName: string): Promise<string[]> {
  const rows = await queryRows<{ name: string }>(
    database.db,
    sql`select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = ${schemaName} and c.relkind = 'r' order by 1`,
  );
  return rows.map((r) => r.name);
}

describe('migrations', () => {
  it('create 27 tables on a fresh PGlite: 13 in ling, 14 in app', async () => {
    const ling = await tables('ling');
    const app = await tables('app');
    expect(ling).toEqual(
      [
        'content_version',
        'exercise',
        'form',
        'lemma',
        'lemma_sentence',
        'lesson',
        'lesson_step',
        'library_text',
        'pattern',
        'scenario',
        'sense',
        'sentence',
        'trigger',
      ].sort(),
    );
    expect(app).toEqual(
      [
        'ai_call',
        'attempt',
        'card',
        'content_report',
        'conversation',
        'lesson_progress',
        'message',
        'note',
        'placement',
        'profile',
        'review',
        'tutor_error',
        'user_lemma',
        'text',
      ].sort(),
    );
    expect(ling.length + app.length).toBe(27);
  });

  it('match the Drizzle schema: drizzle-kit pull of the migrated database finds no drift', async () => {
    const { database: pulled, schema: declared } = await pullAndCompare();
    expect(Object.keys(pulled).sort()).toHaveLength(27);
    expect(pulled).toEqual(declared);
  }, 120_000);

  it('are up to date: drizzle-kit generate would write nothing new', async () => {
    const { generateDrizzleJson, generateMigration } = await import('drizzle-kit/api');
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: { idx: number }[] };
    const last = journal.entries.at(-1)?.idx ?? 0;
    const snapshot = JSON.parse(
      readFileSync(
        join(MIGRATIONS_FOLDER, 'meta', `${String(last).padStart(4, '0')}_snapshot.json`),
        'utf8',
      ),
    );
    const current = generateDrizzleJson(schema, snapshot.id, ['app', 'ling']);
    expect(await generateMigration(snapshot, current)).toEqual([]);
  }, 60_000);
});

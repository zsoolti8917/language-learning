import { rmSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Database, queryRows } from '../client';
import { freshDb } from '../testing/fresh-db';
import { INLINE_CONTENT, INLINE_MANIFEST, writeContentSet } from '../testing/inline-content';
import { ContentValidationError, currentContentVersion, loadContent } from './load';

const LING_TABLES = [
  'lemma',
  'form',
  'sense',
  'sentence',
  'lemma_sentence',
  'trigger',
  'pattern',
  'lesson',
  'lesson_step',
  'exercise',
  'scenario',
  'library_text',
  'content_version',
];

let database: Database;
const dirs: string[] = [];
const folder = (...args: Parameters<typeof writeContentSet>) => {
  const d = writeContentSet(...args);
  dirs.push(d);
  return d;
};

beforeAll(async () => {
  database = await freshDb();
}, 60_000);
afterAll(async () => {
  await database?.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** Every row of schema ling with its xmin: a rewritten row gets a new xmin. */
async function snapshot(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const t of LING_TABLES)
    out[t] = await queryRows(
      database.db,
      sql.raw(`select x.xmin::text as xmin, to_jsonb(x) as row from ling."${t}" x order by 2`),
    );
  return out;
}

const count = async (table: string) =>
  (
    await queryRows<{ n: number }>(
      database.db,
      sql.raw(`select count(*)::int as n from ling."${table}"`),
    )
  )[0]?.n;

describe('loadContent', () => {
  it('rejects an invalid set with file and line, and writes nothing', async () => {
    const bad = folder({
      ...INLINE_CONTENT,
      forms: [...INLINE_CONTENT.forms, { lemmaId: 20, form: 'mestom', tags: 's8' }],
    });
    const err = await loadContent(database, bad).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ContentValidationError);
    expect((err as ContentValidationError).issues.join('\n')).toMatch(/forms\.jsonl:8: tags/);
    expect((err as ContentValidationError).issues.join('\n')).toMatch(/counts\.forms is 7/);
    expect(await count('lemma')).toBe(0);
  });

  it('rejects a set without a manifest', async () => {
    const dir = folder();
    rmSync(`${dir}/manifest.json`);
    await expect(loadContent(database, dir)).rejects.toThrow(/manifest\.json: missing/);
  });

  it('loads a small inline set into every ling table and writes the content version', async () => {
    const result = await loadContent(database, folder());
    expect(result).toEqual({
      version: '2026-12-01.1',
      versionWritten: true,
      rows: {
        lemmas: 4,
        forms: 7,
        senses: 2,
        sentences: 1,
        triggers: 1,
        patterns: 1,
        lessons: 1,
        exercises: 1,
        scenarios: 1,
        library: 1,
      },
    });
    for (const t of LING_TABLES) expect(await count(t), t).toBeGreaterThan(0);
    expect(await count('lemma_sentence')).toBe(2);
    expect(await count('lesson_step')).toBe(2);
    const folded = await queryRows<{ form: string; form_ascii: string }>(
      database.db,
      sql`select form, form_ascii from ling.form where lemma_id in (20, 29) order by form`,
    );
    expect(folded.find((f) => f.form === 'Rodič')?.form_ascii).toBe('rodic');
    expect(folded.find((f) => f.form === 'mestá')?.form_ascii).toBe('mesta');
    const [lemma] = await queryRows<{ lemma_ascii: string }>(
      database.db,
      sql`select lemma_ascii from ling.lemma where id = 62`,
    );
    expect(lemma?.lemma_ascii).toBe('ist');
    const version = await currentContentVersion(database.db);
    expect(version?.version).toBe('2026-12-01.1');
    expect(version?.builtAt.toISOString()).toBe(INLINE_MANIFEST.builtAt);
  });

  it('a second load of the same set changes nothing', async () => {
    const before = await snapshot();
    const result = await loadContent(database, folder());
    expect(result.versionWritten).toBe(false);
    expect(await snapshot()).toEqual(before);
  });

  it('a new build updates rows, keeps retired ones and run time glosses, drops stale steps', async () => {
    await database.withSystem((tx) =>
      tx.execute(
        sql`insert into ling.sense (lemma_id, ord, gloss_en, source) values (62, 0, 'to go', 'runtime')`,
      ),
    );
    const lessons = INLINE_CONTENT.lessons.map((l) => ({ ...l, steps: l.steps.slice(0, 1) }));
    const senses = INLINE_CONTENT.senses.map((s) =>
      s.lemmaId === 20 ? { ...s, glossEn: 'town' } : s,
    );
    const lemmas = INLINE_CONTENT.lemmas.filter((l) => l.id !== 29);
    const result = await loadContent(
      database,
      folder(
        { ...INLINE_CONTENT, lessons, senses, lemmas },
        { ...INLINE_MANIFEST, version: '2026-12-02.1', counts: {} },
      ),
    );
    expect(result.versionWritten).toBe(true);
    expect(await count('lemma')).toBe(4);
    expect(await count('lesson_step')).toBe(1);
    expect(await count('content_version')).toBe(2);
    const glosses = await queryRows<{ lemma_id: number; gloss_en: string }>(
      database.db,
      sql`select lemma_id, gloss_en from ling.sense order by lemma_id`,
    );
    expect(glosses).toEqual([
      { lemma_id: 20, gloss_en: 'town' },
      { lemma_id: 45, gloss_en: 'to, into' },
      { lemma_id: 62, gloss_en: 'to go' },
    ]);
  });
});

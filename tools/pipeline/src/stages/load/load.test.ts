import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDb, lemma as lemmaTable } from '@app/db';
import { MINI_DIR } from '@app/testkit/mini';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readJsonl, writeJsonl } from '../../lib/files';
import { type TempRoot, tempRoot } from '../../lib/testing';
import { measureFormsTable } from '../morph/measure';
import { limitSetByRank, loadSet } from '.';

type Row = Record<string, unknown>;

let t: TempRoot;
let dir: string;
beforeAll(async () => {
  t = await tempRoot();
  // The mini dataset, with its sentences and library cut down so that only a few lemmas are
  // pointed at from outside lemmas, forms and senses.
  dir = join(t.root, 'set');
  await cp(MINI_DIR, dir, { recursive: true });
  const sentences: Row[] = [];
  for await (const s of readJsonl<Row>(join(dir, 'sentences.jsonl'))) sentences.push(s);
  await writeJsonl(join(dir, 'sentences.jsonl'), sentences.slice(0, 1));
  await writeJsonl(join(dir, 'library.jsonl'), []);
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  manifest.counts.sentences = 1;
  manifest.counts.library = 0;
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
});
afterAll(() => t.remove());

async function ids(file: string): Promise<Set<number>> {
  const out = new Set<number>();
  for await (const r of readJsonl<Row>(file)) out.add((r.id ?? r.lemmaId) as number);
  return out;
}

describe('load', () => {
  it('keeps lemmas up to the rank limit and every lemma another file points at', async () => {
    const out = join(t.root, 'limited');
    const counts = await limitSetByRank(dir, out, 5);
    const kept = await ids(join(out, 'lemmas.jsonl'));
    // Ranks 1 to 5 of the mini set: byť, ten, a, ja, na.
    for (const id of [60, 42, 68, 37, 51]) expect(kept.has(id)).toBe(true);
    // Pointed at by triggers, patterns or exercises: kept although ranked lower.
    expect(kept.has(20)).toBe(true); // mesto, model word of a pattern
    expect(kept.has(65)).toBe(true); // pomáhať, a trigger
    expect(kept.size).toBeLessThan(72);
    expect(counts.lemmas).toBe(kept.size);
    for (const id of await ids(join(out, 'forms.jsonl'))) expect(kept.has(id)).toBe(true);
    const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
    expect(manifest.counts.lemmas).toBe(kept.size);
  });

  it('loads a set into the database, with the rank limit', async () => {
    const database = createDb({ mode: 'pglite' });
    try {
      const r = await loadSet(database, dir, { rankLimit: 5, workDir: join(t.root, 'work') });
      expect(r.versionWritten).toBe(true);
      const rows = await database.db.select({ id: lemmaTable.id }).from(lemmaTable);
      expect(rows.length).toBe(r.rows.lemmas);
      expect(rows.length).toBeLessThan(72);
      // A second load of the same set writes no new version.
      expect(
        (await loadSet(database, dir, { rankLimit: 5, workDir: join(t.root, 'work') }))
          .versionWritten,
      ).toBe(false);
    } finally {
      await database.close();
    }
  }, 60_000);

  it('measures the forms table with its indexes', async () => {
    const lemmas: { id: number; key: string; lemma: string; pos: 'noun'; flags: object }[] = [];
    for await (const l of readJsonl<Row>(join(MINI_DIR, 'lemmas.jsonl')))
      lemmas.push({
        id: l.id as number,
        key: l.key as string,
        lemma: l.lemma as string,
        pos: 'noun',
        flags: {},
      });
    const forms: { lemmaId: number; form: string; tags: string }[] = [];
    for await (const f of readJsonl<{ lemmaId: number; form: string; tags: string }>(
      join(MINI_DIR, 'forms.jsonl'),
    ))
      forms.push(f);
    const full = await measureFormsTable(lemmas, forms);
    expect(full).toMatchObject({ rows: forms.length, measuredRows: forms.length, method: 'full' });
    expect(full.indexBytes).toBeGreaterThan(0);
    expect(full.totalBytes).toBeGreaterThanOrEqual(full.tableBytes + full.indexBytes);
    const part = await measureFormsTable(lemmas, forms, { sample: 200 });
    expect(part).toMatchObject({ measuredRows: 200, method: 'sample' });
    expect(part.estimatedBytes).toBeGreaterThan(part.totalBytes);
  }, 60_000);
});

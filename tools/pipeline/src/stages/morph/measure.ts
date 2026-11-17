// Measures the size of `ling.form` with its indexes: the forms go into an in-memory PGlite
// with the real migrations, and Postgres reports the bytes. With a sample, the size per row
// of the sample is scaled up to all rows.
import { foldAscii } from '@app/contracts';
import { createDb, form as formTable, lemma as lemmaTable, migrate } from '@app/db';
import type { FormOut, LemmaOut } from './build';
import { sample as pick } from './compare';

export interface FormsTableSize {
  /** Rows of the forms file. */
  rows: number;
  /** Rows loaded for the measurement. */
  measuredRows: number;
  tableBytes: number;
  indexBytes: number;
  /** Table, indexes and TOAST of the measured rows. */
  totalBytes: number;
  bytesPerRow: number;
  /** totalBytes scaled to every row (equal to totalBytes when every row was loaded). */
  estimatedBytes: number;
  method: 'full' | 'sample';
  ms: number;
}

export async function measureFormsTable(
  lemmas: readonly LemmaOut[],
  forms: readonly FormOut[],
  opts: { sample?: number; seed?: number } = {},
): Promise<FormsTableSize> {
  const started = performance.now();
  const n = opts.sample && opts.sample < forms.length ? opts.sample : forms.length;
  const rows = n < forms.length ? pick(forms, n, opts.seed ?? 7) : forms;
  const ids = new Set(rows.map((r) => r.lemmaId));
  const database = createDb({ mode: 'pglite' });
  try {
    await migrate(database);
    const db = database.db;
    const lemmaRows = lemmas
      .filter((l) => ids.has(l.id))
      .map((l) => ({
        id: l.id,
        key: l.key,
        lemma: l.lemma,
        lemmaAscii: foldAscii(l.lemma),
        pos: l.pos,
        gender: l.gender ?? null,
        pattern: l.pattern ?? null,
        aspect: l.aspect ?? null,
        flags: l.flags,
      }));
    for (let i = 0; i < lemmaRows.length; i += 2000)
      await db.insert(lemmaTable).values(lemmaRows.slice(i, i + 2000));
    for (let i = 0; i < rows.length; i += 5000)
      await db.insert(formTable).values(
        rows.slice(i, i + 5000).map((r) => ({
          lemmaId: r.lemmaId,
          form: r.form,
          formAscii: foldAscii(r.form),
          tags: r.tags,
        })),
      );
    await database.exec('vacuum analyze ling.form');
    const pg = database.pglite;
    if (!pg) throw new Error('measure: expected a PGlite database');
    const res = await pg.query<{ table: string; indexes: string; total: string }>(
      `select pg_table_size('ling.form')::text as "table",
              pg_indexes_size('ling.form')::text as "indexes",
              pg_total_relation_size('ling.form')::text as "total"`,
    );
    const size = res.rows[0];
    const total = Number(size?.total ?? 0);
    const perRow = rows.length > 0 ? total / rows.length : 0;
    return {
      rows: forms.length,
      measuredRows: rows.length,
      tableBytes: Number(size?.table ?? 0),
      indexBytes: Number(size?.indexes ?? 0),
      totalBytes: total,
      bytesPerRow: Math.round(perRow * 10) / 10,
      estimatedBytes: Math.round(perRow * forms.length),
      method: rows.length === forms.length ? 'full' : 'sample',
      ms: Math.round(performance.now() - started),
    };
  } finally {
    await database.close();
  }
}

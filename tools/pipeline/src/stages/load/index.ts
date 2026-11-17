// Stage 12, load: loads a validated content set into schema `ling` with loadContent (F3),
// which adds a content_version row. --rank-limit N keeps only lemmas ranked 1 to N, plus every
// lemma another file points at, when the forms would not fit the database.
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { type ContentFileName, type LemmaRow, MANIFEST_FILE, type Manifest } from '@app/contracts';
import { createDb, type Database, type LoadResult, loadContent, migrate } from '@app/db';
import { existsSync, JsonlWriter, readJson, readJsonl, writeFileAtomic } from '../../lib/files';
import { codeDirOf, resolveArg, type Stage, type StageContext } from '../../lib/runner';
import { setFiles } from '../../lib/set';

/** Files whose rows belong to one lemma and go with it. */
const PER_LEMMA: ContentFileName[] = ['forms.jsonl', 'senses.jsonl'];

/** Lemma ids that rows outside lemmas, forms and senses point at. */
async function referencedLemmas(dir: string): Promise<Set<number>> {
  const ids = new Set<number>();
  const add = (id: unknown) => {
    if (typeof id === 'number') ids.add(id);
  };
  type Row = Record<string, unknown>;
  const rows = (f: string) => readJsonl<Row>(join(dir, f));
  if (existsSync(join(dir, 'sentences.jsonl')))
    for await (const s of rows('sentences.jsonl')) {
      for (const t of (s.tokens as Row[] | undefined) ?? []) add(t.lemmaId);
      for (const l of (s.links as Row[] | undefined) ?? []) add(l.lemmaId);
    }
  if (existsSync(join(dir, 'triggers.jsonl')))
    for await (const t of rows('triggers.jsonl')) add(t.lemmaId);
  if (existsSync(join(dir, 'patterns.jsonl')))
    for await (const p of rows('patterns.jsonl')) {
      add(p.modelLemmaId);
      add(p.everydayModelLemmaId);
    }
  if (existsSync(join(dir, 'exercises.jsonl')))
    for await (const e of rows('exercises.jsonl'))
      for (const id of ((e.target as Row | undefined)?.lemmaIds as unknown[] | undefined) ?? [])
        add(id);
  if (existsSync(join(dir, 'library.jsonl')))
    for await (const l of rows('library.jsonl')) {
      for (const id of Object.keys((l.lemmaCounts as Row | undefined) ?? {})) add(Number(id));
      const a = l.analysis as { lemmas?: Row; sentences?: { tokens?: Row[] }[] } | undefined;
      for (const id of Object.keys(a?.lemmas ?? {})) add(Number(id));
      for (const s of a?.sentences ?? []) for (const t of s.tokens ?? []) add(t.l);
    }
  return ids;
}

/**
 * Writes a copy of a set that keeps the lemmas ranked up to `limit` and every lemma another
 * file points at, with their forms and senses. Other files are copied unchanged.
 */
export async function limitSetByRank(
  dir: string,
  outDir: string,
  limit: number,
): Promise<Record<string, number>> {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const keep = await referencedLemmas(dir);
  const counts: Record<string, number> = {};
  const w = await JsonlWriter.open(join(outDir, 'lemmas.jsonl'));
  for await (const l of readJsonl<LemmaRow>(join(dir, 'lemmas.jsonl'))) {
    if ((l.freqRank !== undefined && l.freqRank <= limit) || keep.has(l.id)) {
      keep.add(l.id);
      await w.write(l);
    }
  }
  await w.close();
  counts.lemmas = w.count;
  for (const file of await setFiles(dir)) {
    if (file === 'lemmas.jsonl' || file === MANIFEST_FILE) continue;
    const out = await JsonlWriter.open(join(outDir, file));
    const perLemma = PER_LEMMA.includes(file as ContentFileName);
    for await (const row of readJsonl<{ lemmaId?: number }>(join(dir, file)))
      if (!perLemma || keep.has(row.lemmaId as number)) await out.write(row);
    await out.close();
    counts[file.replace(/\.jsonl$/u, '')] = out.count;
  }
  const manifest = await readJson<Manifest>(join(dir, MANIFEST_FILE));
  await writeFileAtomic(
    join(outDir, MANIFEST_FILE),
    `${JSON.stringify({ ...manifest, counts: { ...manifest.counts, ...counts } }, null, 2)}\n`,
  );
  return counts;
}

/** The database: --pglite <dir>, or DB_MODE=pglite (PGLITE_DATA_DIR), or DATABASE_URL. */
export function openDatabase(ctx: StageContext): Database {
  const base = process.env.INIT_CWD ?? process.cwd();
  const dir =
    resolveArg(ctx.args.pglite, base) ??
    (process.env.DB_MODE === 'pglite'
      ? resolve(process.env.PGLITE_DATA_DIR ?? join(ctx.paths.root, '.local/pgdata'))
      : undefined);
  if (dir) return createDb({ mode: 'pglite', dataDir: dir });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('load: set DATABASE_URL, or DB_MODE=pglite, or pass --pglite <dir>');
  return createDb({ mode: 'postgres', url, max: 1 });
}

export async function loadSet(
  database: Database,
  dir: string,
  opts: { rankLimit?: number; workDir: string; log?: (s: string) => void },
): Promise<LoadResult & { dir: string }> {
  let folder = dir;
  if (opts.rankLimit !== undefined) {
    folder = join(opts.workDir, `rank-${opts.rankLimit}`);
    const counts = await limitSetByRank(dir, folder, opts.rankLimit);
    opts.log?.(`load: rank limit ${opts.rankLimit}: ${JSON.stringify(counts)}`);
  }
  if (database.mode === 'pglite') await migrate(database);
  const result = await loadContent(database, folder);
  return { ...result, dir: folder };
}

export const loadStage: Stage = {
  name: 'load',
  description:
    'Loads the validated set into schema ling (loadContent), with an optional --rank-limit',
  codeDir: codeDirOf(import.meta.url),
  alwaysRun: true,
  options: {
    dir: { type: 'string' },
    'rank-limit': { type: 'string' },
    pglite: { type: 'string' },
  },
  inputs: () => [],
  outputs: () => [],
  run: async (ctx) => {
    const dir = resolveArg(ctx.args.dir, process.env.INIT_CWD ?? process.cwd()) ?? ctx.paths.set;
    if (!existsSync(join(dir, MANIFEST_FILE)))
      throw new Error(`load: ${dir} holds no content set; run validate first`);
    const raw = ctx.args['rank-limit'];
    const rankLimit = typeof raw === 'string' ? Number(raw) : undefined;
    if (rankLimit !== undefined && !(Number.isInteger(rankLimit) && rankLimit > 0))
      throw new Error(`load: --rank-limit must be a positive whole number, not "${raw}"`);
    const database = openDatabase(ctx);
    try {
      const t = performance.now();
      const r = await loadSet(database, dir, {
        ...(rankLimit ? { rankLimit } : {}),
        workDir: join(ctx.paths.build, 'load'),
        log: ctx.log,
      });
      ctx.log(
        `load: content ${r.version} loaded in ${Math.round(performance.now() - t)} ms${r.versionWritten ? '' : ' (unchanged)'}: ${JSON.stringify(r.rows)}`,
      );
      return { version: r.version, rows: r.rows, versionWritten: r.versionWritten };
    } finally {
      await database.close();
    }
  },
};

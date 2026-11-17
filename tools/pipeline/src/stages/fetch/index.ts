// Stage 1, fetch: places a source in content/raw/<id>/ with its checksum and records URL,
// date and licence in content/SOURCES.md. A file comes from a local folder when one is given
// (--from, or PIPELINE_RAW_FROM, or the shared folder of the cloud containers), else it is
// downloaded from its URL. A file already in place with the right checksum is left alone.
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { existsSync, sha256File, stableJson, writeFileAtomic } from '../../lib/files';
import { codeDirOf, resolveArg, type Stage, type StageContext } from '../../lib/runner';
import {
  type FetchedRow,
  rawDir,
  readSourceRecord,
  recordInSourcesMd,
  SOURCE_RECORD,
  SOURCES,
  type Source,
  type SourceRecord,
  sourceById,
} from '../../lib/sources';

/** Where the cloud containers keep a copy of every source (read only). */
export const SHARED_RAW_DIR = '/mnt/project-files/raw-data';

export interface FetchOptions {
  sources: Source[];
  /** Local folders to copy from, tried in order. */
  from: string[];
  /** Accept a file whose checksum differs from the catalog. */
  allowChanged: boolean;
  /** Only these file names. */
  files?: string[];
  download?: (url: string, dest: string) => Promise<void>;
}

export interface FetchedFile {
  source: string;
  file: string;
  status: 'up to date' | 'copied' | 'downloaded';
  sha256: string;
  bytes: number;
}

async function httpDownload(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`GET ${url}: ${res.status} ${res.statusText}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
}

function localCandidates(from: string[], id: string, file: string): string | null {
  for (const dir of from)
    for (const p of [join(dir, id, file), join(dir, file)]) if (existsSync(p)) return p;
  return null;
}

export async function fetchSources(ctx: StageContext, opts: FetchOptions): Promise<FetchedFile[]> {
  const done: FetchedFile[] = [];
  const day = ctx.now().toISOString().slice(0, 10);
  for (const source of opts.sources) {
    const dir = rawDir(ctx.paths.raw, source.id);
    await mkdir(dir, { recursive: true });
    const prev = await readSourceRecord(ctx.paths.raw, source.id);
    const record: SourceRecord = {
      id: source.id,
      name: source.name,
      page: source.page,
      license: source.license,
      files: [...(prev?.files ?? [])],
    };
    const rows: FetchedRow[] = [];
    for (const f of source.files) {
      if (opts.files && !opts.files.includes(f.name)) continue;
      const dest = join(dir, f.name);
      const before = record.files.find((r) => r.name === f.name);
      let status: FetchedFile['status'] = 'up to date';
      let from = before?.from ?? '';
      let sha = existsSync(dest) ? await sha256File(dest) : null;
      const wanted = f.sha256 ?? before?.sha256;
      if (!sha || (wanted && sha !== wanted)) {
        const tmp = `${dest}.part`;
        const local = localCandidates(opts.from, source.id, f.name);
        try {
          if (local) {
            ctx.log(`fetch: ${source.id}/${f.name} ← ${local}`);
            await copyFile(local, tmp);
            status = 'copied';
            from = `local copy of ${local}`;
          } else {
            ctx.log(`fetch: ${source.id}/${f.name} ← ${f.url}`);
            await (opts.download ?? httpDownload)(f.url, tmp);
            status = 'downloaded';
            from = f.url;
          }
          sha = await sha256File(tmp);
          if (f.sha256 && sha !== f.sha256 && !opts.allowChanged)
            throw new Error(
              `${source.id}/${f.name}: sha256 ${sha} differs from the catalog's ${f.sha256}. The source changed; check it, then pass --allow-changed and update lib/sources.ts.`,
            );
          await rename(tmp, dest);
        } finally {
          await rm(tmp, { force: true });
        }
      }
      const bytes = (await stat(dest)).size;
      const fetchedAt = before && before.sha256 === sha ? before.fetchedAt : day;
      const entry = { name: f.name, url: f.url, sha256: sha as string, bytes, fetchedAt, from };
      record.files = [...record.files.filter((r) => r.name !== f.name), entry].sort((a, b) =>
        a.name < b.name ? -1 : 1,
      );
      rows.push({
        source: source.id,
        file: f.name,
        url: f.url,
        fetchedAt,
        bytes,
        sha256: entry.sha256,
        license: source.license,
      });
      done.push({ source: source.id, file: f.name, status, sha256: entry.sha256, bytes });
      ctx.log(`fetch: ${source.id}/${f.name} ${status}, sha256 ${entry.sha256}`);
    }
    await writeFileAtomic(join(dir, SOURCE_RECORD), stableJson(record));
    await recordInSourcesMd(ctx.paths.sourcesMd, rows);
  }
  return done;
}

function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap((x) => String(x).split(','));
  if (typeof v === 'string') return v.split(',');
  return [];
}

export function fetchOptionsFrom(ctx: StageContext): FetchOptions {
  const ids = list(ctx.args.source);
  if (ids.length === 0)
    throw new Error(
      `fetch: name a source with --source <id> (or "all"). Known: ${SOURCES.map((s) => s.id).join(', ')}`,
    );
  const sources = ids.includes('all') ? [...SOURCES] : ids.map((id) => sourceById(id));
  const base = process.env.INIT_CWD ?? process.cwd();
  const from = [
    resolveArg(ctx.args.from, base),
    process.env.PIPELINE_RAW_FROM,
    ctx.args['no-shared'] ? undefined : SHARED_RAW_DIR,
  ].filter((x): x is string => !!x && existsSync(x));
  const files = list(ctx.args.file);
  return {
    sources,
    from,
    allowChanged: ctx.args['allow-changed'] === true,
    ...(files.length ? { files } : {}),
  };
}

export const fetchStage: Stage = {
  name: 'fetch',
  description: 'Places a source in content/raw/ with its checksum, recorded in content/SOURCES.md',
  codeDir: codeDirOf(import.meta.url),
  alwaysRun: true,
  options: {
    source: { type: 'string', multiple: true },
    file: { type: 'string', multiple: true },
    from: { type: 'string' },
    'no-shared': { type: 'boolean' },
    'allow-changed': { type: 'boolean' },
  },
  inputs: () => [],
  outputs: (ctx) => [ctx.paths.sourcesMd],
  run: async (ctx) => {
    const files = await fetchSources(ctx, fetchOptionsFrom(ctx));
    return { files: files.map((f) => `${f.source}/${f.file}: ${f.status}`) };
  },
};

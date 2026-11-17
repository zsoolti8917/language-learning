// Assembles the content set (docs/contracts.md, "Content files") from the files the stages
// wrote. Each stage declares its parts; validate assembles them into content/build/set/.
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { CONTENT_FILES, type ContentFileName, MANIFEST_FILE, type Manifest } from '@app/contracts';
import {
  existsSync,
  JsonlWriter,
  listFiles,
  readJson,
  readJsonl,
  sha256File,
  stableJson,
  writeFileAtomic,
} from './files';
import type { Paths } from './paths';

export interface SetPart {
  /** The content file this part goes into. */
  file: ContentFileName;
  /** Where the stage wrote the part. */
  path: (paths: Paths) => string;
  /**
   * `rows` (default): whole rows, appended in the order the stages are registered.
   * `merge`: partial rows merged onto the rows of the same file by `key` (default `id`);
   * `flags` objects are merged one level deep. C2 uses it to add ranks to the lemmas.
   */
  mode?: 'rows' | 'merge';
  key?: string;
}

export type ManifestSource = Manifest['sources'][number];

export interface AssembleResult {
  /** Rows per file, keyed by file name without extension. */
  counts: Record<string, number>;
  manifest: Manifest;
  /** False when every file came out identical to the set already there. */
  changed: boolean;
}

const base = (file: string) => file.replace(/\.jsonl$/u, '');

async function copyLines(from: string, to: JsonlWriter): Promise<void> {
  // Rows that need no merge are copied as text: the forms file has over a million rows.
  const rl = createInterface({
    input: createReadStream(from, 'utf8'),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  for await (const line of rl) {
    if (line.trim() === '') continue;
    await to.writeRaw(line);
  }
}

function mergeRow(
  row: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...row, ...patch };
  if (row.flags && patch.flags && typeof row.flags === 'object' && typeof patch.flags === 'object')
    out.flags = { ...(row.flags as object), ...(patch.flags as object) };
  return out;
}

/** The next version for a build made on `now`: 'YYYY-MM-DD.N'. */
export function nextVersion(now: Date, previous?: string): string {
  const day = now.toISOString().slice(0, 10);
  const m = previous ? /^(\d{4}-\d{2}-\d{2})\.(\d+)$/u.exec(previous) : null;
  return m && m[1] === day ? `${day}.${Number(m[2]) + 1}` : `${day}.1`;
}

/**
 * Writes every content file that has parts, then the manifest. When all files come out
 * byte for byte as they were and the sources did not change, the old manifest is kept, so a
 * rerun leaves the set untouched.
 */
export async function assembleSet(opts: {
  paths: Paths;
  parts: readonly SetPart[];
  outDir: string;
  sources: ManifestSource[];
  now: Date;
}): Promise<AssembleResult> {
  const { paths, parts, outDir } = opts;
  const tmp = `${outDir}.tmp-${process.pid}`;
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  const counts: Record<string, number> = {};
  try {
    for (const file of Object.keys(CONTENT_FILES) as ContentFileName[]) {
      const mine = parts.filter((p) => p.file === file);
      const rows = mine.filter((p) => (p.mode ?? 'rows') === 'rows');
      if (rows.length === 0) continue;
      const merges = mine.filter((p) => p.mode === 'merge');
      const patches = new Map<string, Record<string, unknown>>();
      for (const m of merges) {
        const path = m.path(paths);
        if (!existsSync(path)) continue;
        for await (const p of readJsonl<Record<string, unknown>>(path)) {
          const k = String(p[m.key ?? 'id']);
          patches.set(k, mergeRow(patches.get(k) ?? {}, p));
        }
      }
      const keyField = merges[0]?.key ?? 'id';
      const w = await JsonlWriter.open(join(tmp, file));
      for (const part of rows) {
        const path = part.path(paths);
        if (!existsSync(path))
          throw new Error(`${file}: part ${path} is missing; run its stage first`);
        if (patches.size === 0) await copyLines(path, w);
        else
          for await (const row of readJsonl<Record<string, unknown>>(path)) {
            const patch = patches.get(String(row[keyField]));
            await w.write(patch ? mergeRow(row, patch) : row);
          }
      }
      await w.close();
      counts[base(file)] = w.count;
    }

    const manifestPath = join(outDir, MANIFEST_FILE);
    const old = existsSync(manifestPath) ? await readJson<Manifest>(manifestPath) : null;
    const same =
      old !== null &&
      stableJson(old.sources) === stableJson(opts.sources) &&
      (await sameFiles(tmp, outDir));
    if (same && old) {
      await rm(tmp, { recursive: true, force: true });
      return { counts, manifest: old, changed: false };
    }
    const manifest: Manifest = {
      version: nextVersion(opts.now, old?.version),
      builtAt: opts.now.toISOString(),
      sources: opts.sources,
      counts,
    };
    await writeFileAtomic(join(tmp, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
    await rm(outDir, { recursive: true, force: true });
    await rename(tmp, outDir);
    return { counts, manifest, changed: true };
  } catch (e) {
    await rm(tmp, { recursive: true, force: true });
    throw e;
  }
}

/** True when both folders hold the same content files (the manifest aside), byte for byte. */
async function sameFiles(a: string, b: string): Promise<boolean> {
  if (!existsSync(b)) return false;
  const fa = (await listFiles(a)).filter((f) => f !== MANIFEST_FILE);
  const fb = (await listFiles(b)).filter((f) => f !== MANIFEST_FILE);
  if (fa.join('\n') !== fb.join('\n')) return false;
  for (const f of fa)
    if ((await sha256File(join(a, f))) !== (await sha256File(join(b, f)))) return false;
  return true;
}

/** Content files present in a set folder. */
export async function setFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).filter((f) => f in CONTENT_FILES || f === MANIFEST_FILE).sort();
}

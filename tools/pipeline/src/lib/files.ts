// Small file helpers: hashing, atomic writes, JSON lines.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { finished } from 'node:stream/promises';
import { readLines } from './lines';

export { existsSync };

/** sha256 of a file, as lower case hex. */
export async function sha256File(path: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest('hex');
}

export function sha256(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Writes a file through a temporary name, so a crash never leaves half a file. */
export async function writeFileAtomic(path: string, data: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

/** Every file below a folder, sorted, as paths relative to it. Missing folder: empty. */
export async function listFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = async (d: string) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) out.push(relative(dir, p));
    }
  };
  await walk(dir);
  return out.sort();
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** A JSON lines writer that streams rows into a temporary file and renames it on close. */
export class JsonlWriter {
  private readonly tmp: string;
  private readonly out;
  private pending: string[] = [];
  count = 0;

  private constructor(readonly path: string) {
    this.tmp = `${path}.tmp-${process.pid}`;
    this.out = createWriteStream(this.tmp, 'utf8');
  }

  static async open(path: string): Promise<JsonlWriter> {
    await mkdir(dirname(path), { recursive: true });
    return new JsonlWriter(path);
  }

  async write(row: unknown): Promise<void> {
    await this.writeRaw(JSON.stringify(row));
  }

  /** Writes one line that is already JSON. */
  async writeRaw(line: string): Promise<void> {
    this.pending.push(line);
    this.count++;
    if (this.pending.length >= 1000) await this.flush();
  }

  private async flush(): Promise<void> {
    if (this.pending.length === 0) return;
    const chunk = `${this.pending.join('\n')}\n`;
    this.pending = [];
    if (!this.out.write(chunk)) await new Promise<void>((r) => this.out.once('drain', () => r()));
  }

  async close(): Promise<void> {
    await this.flush();
    this.out.end();
    await finished(this.out);
    await rename(this.tmp, this.path);
  }

  async abort(): Promise<void> {
    this.out.destroy();
    await rm(this.tmp, { force: true });
  }
}

export async function writeJsonl(path: string, rows: Iterable<unknown>): Promise<number> {
  const w = await JsonlWriter.open(path);
  for (const r of rows) await w.write(r);
  await w.close();
  return w.count;
}

/** Streams the rows of a JSON lines file (plain or compressed). Blank lines are skipped. */
export async function* readJsonl<T = unknown>(path: string): AsyncGenerator<T> {
  let n = 0;
  for await (const line of readLines(path)) {
    n++;
    if (line.trim() === '') continue;
    try {
      yield JSON.parse(line) as T;
    } catch (e) {
      throw new Error(`${path}:${n}: not JSON: ${(e as Error).message}`);
    }
  }
}

export async function readJson<T = unknown>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

/** Stable JSON: object keys sorted, two space indent, final newline. */
export function stableJson(value: unknown): string {
  return `${JSON.stringify(
    value,
    (_k, x: unknown) =>
      x && typeof x === 'object' && !Array.isArray(x)
        ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
        : x,
    2,
  )}\n`;
}

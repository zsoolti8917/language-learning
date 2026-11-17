// Reads a text file line by line as a stream, decompressing it on the fly.
// Node has gzip but no xz or bzip2, so `.xz` and `.bz2` go through the system tools
// `xz -dc` and `bzip2 -dc` (present on Linux and macOS; on Windows use WSL).
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';

const TOOLS: Record<string, string> = { '.xz': 'xz', '.bz2': 'bzip2' };

function extOf(path: string): string {
  const m = /\.(xz|bz2|gz)$/u.exec(path);
  return m ? `.${m[1]}` : '';
}

/** Opens a file as a stream of decompressed bytes. `done` rejects if the decompressor failed. */
export function openDecompressed(path: string): {
  stream: Readable;
  done: Promise<void>;
  stop: () => void;
} {
  const ext = extOf(path);
  const tool = TOOLS[ext];
  if (tool) {
    const child = spawn(tool, ['-dc', path], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    const done = new Promise<void>((resolve, reject) => {
      child.on('error', (e: NodeJS.ErrnoException) =>
        reject(
          e.code === 'ENOENT'
            ? new Error(`"${tool}" is not installed; it is needed to read ${path}`)
            : e,
        ),
      );
      child.on('close', (code, signal) => {
        if (code === 0 || signal === 'SIGTERM') resolve();
        else reject(new Error(`${tool} -dc ${path} failed (${code}): ${stderr.trim()}`));
      });
    });
    return { stream: child.stdout, done, stop: () => child.kill('SIGTERM') };
  }
  const file = createReadStream(path);
  const stream = ext === '.gz' ? file.pipe(createGunzip()) : file;
  const done = new Promise<void>((resolve, reject) => {
    file.on('error', reject);
    stream.on('error', reject);
    stream.on('end', () => resolve());
    stream.on('close', () => resolve());
  });
  return { stream, done, stop: () => file.destroy() };
}

/** Yields every line of a file (plain, .gz, .xz or .bz2), without the line break. */
export async function* readLines(path: string): AsyncGenerator<string> {
  const { stream, done, stop } = openDecompressed(path);
  // Surface a failure to start (missing tool, missing file) instead of yielding nothing.
  let failure: unknown = null;
  done.catch((e: unknown) => {
    failure = e;
  });
  const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  try {
    for await (const line of rl) yield line;
  } finally {
    rl.close();
    if (!stream.readableEnded) {
      stream.destroy();
      stop();
    }
  }
  await done.catch(() => undefined);
  if (failure) throw failure;
}

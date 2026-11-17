// The first load budget (docs/architecture.md, "Limits and checks"): at most 200 KB of
// compressed JavaScript. Reads the Vite manifest of a finished build and sums the gzip size
// of the entry chunk and everything it imports statically. Lazy screens do not count.
//
//   pnpm --filter @app/web build && pnpm --filter @app/web size
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

export const BUDGET_BYTES = 200 * 1024;

/** The JS files of the first load: the HTML entry and its static imports, transitively. */
export function firstLoadFiles(manifest, entry = 'index.html') {
  const seen = new Set();
  const files = [];
  const visit = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) throw new Error(`manifest has no entry "${key}"`);
    if (chunk.file.endsWith('.js')) files.push(chunk.file);
    for (const dep of chunk.imports ?? []) visit(dep);
  };
  visit(entry);
  return files;
}

function main() {
  const dist = fileURLToPath(new URL('../dist/', import.meta.url));
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(`${dist}.vite/manifest.json`, 'utf8'));
  } catch {
    console.error('No build found. Run `pnpm --filter @app/web build` first.');
    process.exit(2);
  }
  let total = 0;
  for (const file of firstLoadFiles(manifest)) {
    const size = gzipSync(readFileSync(dist + file), { level: 9 }).length;
    total += size;
    console.log(`${(size / 1024).toFixed(1).padStart(8)} KB  ${file}`);
  }
  const ok = total <= BUDGET_BYTES;
  console.log(
    `${(total / 1024).toFixed(1).padStart(8)} KB  first load, gzip (budget ${BUDGET_BYTES / 1024} KB) ${ok ? 'ok' : 'OVER BUDGET'}`,
  );
  if (!ok) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

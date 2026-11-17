// Dependency check: enforces the import rules over every workspace package.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { checkFile, checkManifest } from './deps-rules.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const DIRS = ['apps', 'packages', 'tools'];
const SKIP = new Set(['node_modules', 'dist', '.turbo', 'coverage']);

function* walk(dir) {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.[cm]?[jt]sx?$/.test(e)) yield p;
  }
}

const pkgDirs = [];
for (const d of DIRS) for (const e of readdirSync(join(ROOT, d))) pkgDirs.push(join(ROOT, d, e));
pkgDirs.push(join(ROOT, 'e2e'));

const errors = [];
let files = 0;
for (const dir of pkgDirs) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  } catch {
    continue;
  }
  errors.push(...checkManifest(manifest.name, manifest));
  for (const f of walk(dir)) {
    files++;
    const rel = relative(dir, f).split(sep).join('/');
    errors.push(...checkFile(manifest.name, rel, readFileSync(f, 'utf8')));
  }
}
if (errors.length) {
  console.error(`Dependency check failed (${errors.length}):\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log(`Dependency check passed: ${pkgDirs.length} packages, ${files} files.`);

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('..', import.meta.url).pathname;
const ALLOWED = ['@app/contracts'];
const IMPORT_RE =
  /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;
/** Globals that exist only in Node or only in a browser, or that do input or output. */
const HOST_GLOBALS =
  /\b(process|Buffer|require|__dirname|__filename|window|document|navigator|localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest|WebSocket|console|setTimeout|setInterval|crypto)\b/;

function* sources(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* sources(p);
    else if (/\.ts$/.test(e) && !/\.test\.ts$/.test(e)) yield p;
  }
}

const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the ling package', () => {
  const files = [...sources(join(ROOT, 'src'))];

  it('imports only @app/contracts', () => {
    const outside: string[] = [];
    for (const file of files) {
      for (const m of readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
        const spec = m[1] ?? m[2] ?? m[3] ?? '';
        if (!spec.startsWith('.') && !ALLOWED.includes(spec))
          outside.push(`${relative(ROOT, file)}: ${spec}`);
      }
    }
    expect(outside).toEqual([]);
  });

  it('uses no host globals, so it runs unchanged in a browser and in Node without input or output', () => {
    const used = files.flatMap((file) => {
      const m = HOST_GLOBALS.exec(stripComments(readFileSync(file, 'utf8')));
      return m ? [`${relative(ROOT, file)}: ${m[1]}`] : [];
    });
    expect(used).toEqual([]);
  });

  it('depends on @app/contracts only', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(ALLOWED);
  });
});

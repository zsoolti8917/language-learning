// The design system stays at the bottom of the client: nothing in ui/ imports
// from features/ or lib/ (or from contracts, which the app layer maps onto ui props).
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const UI = import.meta.dirname;
const FORBIDDEN = [/(^|\/)features(\/|$)/, /(^|\/)lib(\/|$)/, /^@app\//];

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.(ts|tsx|css)$/.test(e.name) ? [p] : [];
  });
}

const SPEC =
  /(?:import|export)\s[^'"]*?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]|@import\s+['"]([^'"]+)['"]/g;

describe('ui imports', () => {
  it('never import from features/, lib/ or workspace packages', () => {
    const bad: string[] = [];
    for (const f of files(UI)) {
      if (f.endsWith('imports.test.ts')) continue;
      for (const m of readFileSync(f, 'utf8').matchAll(SPEC)) {
        const spec = (m[1] ?? m[2] ?? m[3]) as string;
        if (FORBIDDEN.some((r) => r.test(spec))) bad.push(`${relative(UI, f)}: ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('scans the component files', () => {
    expect(files(UI).map((f) => relative(UI, f))).toContain('TokenText.tsx');
  });
});

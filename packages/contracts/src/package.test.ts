import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as contracts from './index';

const ROOT = new URL('..', import.meta.url).pathname;
const IMPORT_RE =
  /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;

function* sources(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* sources(p);
    else if (/\.ts$/.test(e) && !/\.test\.ts$/.test(e)) yield p;
  }
}

describe('the contracts package', () => {
  it('imports nothing except zod', () => {
    const outside: string[] = [];
    for (const dir of ['src', 'scripts']) {
      for (const file of sources(join(ROOT, dir))) {
        for (const m of readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
          const spec = m[1] ?? m[2] ?? m[3] ?? '';
          if (spec !== 'zod' && !spec.startsWith('.'))
            outside.push(`${relative(ROOT, file)}: ${spec}`);
        }
      }
    }
    expect(outside).toEqual([]);
  });

  it('depends on zod only', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(['zod']);
    expect(Object.keys(pkg.devDependencies ?? {})).toEqual([]);
  });

  it('exports every enum as a constant array and a zod enum', () => {
    expect(contracts.CASES).toEqual(['nom', 'gen', 'dat', 'acc', 'voc', 'loc', 'ins']);
    expect(contracts.CaseSchema.options).toEqual([...contracts.CASES]);
    expect(contracts.ERROR_TYPES).toHaveLength(17);
    expect(contracts.isCaseErrorType('genitive_plural')).toBe(true);
    expect(contracts.isCaseErrorType('spelling')).toBe(false);
    expect(Object.keys(contracts.ERROR_STATUS).sort()).toEqual([...contracts.ERROR_CODES].sort());
    expect(contracts.RatingSchema.safeParse(5).success).toBe(false);
    expect(contracts.RatingSchema.parse(3)).toBe(3);
  });

  it('keeps the openapi builder out of the public exports', () => {
    expect(Object.keys(contracts)).not.toContain('buildOpenApi');
  });

  it('refuses a prompted tutor error that reveals the expected form', () => {
    const base = contracts.examples['tutor.getConversation'].ok[0].response.body?.errors[0];
    expect(contracts.TutorErrorSchema.safeParse(base).success).toBe(true);
    expect(contracts.TutorErrorSchema.safeParse({ ...base, expected: 'kamarátom' }).success).toBe(
      false,
    );
  });

  it('formats a stream event for the wire', () => {
    expect(contracts.formatSseEvent({ event: 'delta', data: { text: 'S kým ' } })).toBe(
      'event: delta\ndata: {"text":"S kým "}\n\n',
    );
  });
});

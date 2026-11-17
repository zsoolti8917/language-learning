import { describe, expect, it } from 'vitest';
// @ts-expect-error: plain ESM script without type declarations
import { BUDGET_BYTES, firstLoadFiles } from './size-budget.mjs';

describe('size budget', () => {
  it('counts the entry and its static imports, not lazy chunks', () => {
    const manifest = {
      'index.html': { file: 'assets/index.js', imports: ['_shared.js'], dynamicImports: ['lazy'] },
      '_shared.js': { file: 'assets/shared.js', imports: ['index.html'] },
      lazy: { file: 'assets/Lazy.js', imports: ['_shared.js'] },
    };
    expect(firstLoadFiles(manifest)).toEqual(['assets/index.js', 'assets/shared.js']);
  });

  it('is 200 KB', () => {
    expect(BUDGET_BYTES).toBe(204_800);
  });
});

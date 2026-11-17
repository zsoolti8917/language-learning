// The inline script in index.html applies the saved theme before the first paint.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_KEY } from '../features/today/theme';

const html = readFileSync(join(import.meta.dirname, '../../index.html'), 'utf8');
const script = /<script id="theme-boot">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

function runBootScript(): void {
  new Function(script)();
}

afterEach(() => {
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
});

describe('theme boot script', () => {
  it('sits in the head, before the app script, and reads the key M1 writes', () => {
    expect(script).toContain(`'${THEME_KEY}'`);
    expect(html.indexOf('id="theme-boot"')).toBeLessThan(html.indexOf('</head>'));
  });

  it.each(['light', 'dark'] as const)('applies a saved %s theme', (theme) => {
    localStorage.setItem(THEME_KEY, theme);
    runBootScript();
    expect(document.documentElement.dataset.theme).toBe(theme);
  });

  it('leaves the system theme and unknown values alone', () => {
    localStorage.setItem(THEME_KEY, 'system');
    runBootScript();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    localStorage.setItem(THEME_KEY, 'neon');
    runBootScript();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('does not throw when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(runBootScript).not.toThrow();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});

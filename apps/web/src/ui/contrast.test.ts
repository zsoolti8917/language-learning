// Computes WCAG contrast from the colour tokens in tokens.css and requires level AA:
// 4.5:1 for text, 3:1 for non-text parts (field borders, focus ring, underlines).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CASES } from './cases';

const css = readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf8');

type Theme = Record<string, string>;

/** Reads the --ui-* declarations of the first rule whose selector matches. */
function block(selector: RegExp): Theme {
  const m = selector.exec(css);
  if (!m) throw new Error(`no rule ${selector}`);
  const body = css.slice(m.index + m[0].length, css.indexOf('}', m.index + m[0].length));
  const out: Theme = {};
  for (const d of body.matchAll(/--ui-([\w-]+):\s*([^;]+);/g))
    out[d[1] as string] = (d[2] as string).trim();
  return out;
}

const light = block(/:root,\s*\[data-theme="light"\]\s*\{/);
const dark = block(/\n\[data-theme="dark"\]\s*\{/);
const darkSystem = block(/:root:not\(\[data-theme="light"\]\)\s*\{/);
const THEMES: [string, Theme][] = [
  ['light', light],
  ['dark', dark],
];

function rgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not an opaque #rrggbb colour: ${hex}`);
  const n = Number.parseInt(m[1] as string, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = 4.5;
const NON_TEXT = 3;

/** [foreground, background, minimum] token pairs. */
function pairs(): [string, string, number][] {
  const p: [string, string, number][] = [];
  for (const bg of ['bg', 'surface', 'surface-2']) {
    p.push(['fg', bg, TEXT], ['fg-muted', bg, TEXT]);
  }
  p.push(
    ['primary-fg', 'primary', TEXT],
    ['primary-fg', 'primary-hover', TEXT],
    ['danger-fg', 'danger', TEXT],
    ['primary', 'surface', TEXT], // text buttons and toast actions
    ['primary', 'bg', TEXT],
    ['fg', 'primary-soft', TEXT], // accent bar hover
    ['fg', 'token-selected', TEXT],
    ['focus', 'bg', NON_TEXT],
    ['focus', 'surface', NON_TEXT],
    ['border-strong', 'surface', NON_TEXT], // field borders
    ['border-strong', 'bg', NON_TEXT],
  );
  for (const s of ['correct', 'close', 'wrong']) {
    p.push(
      [s, 'bg', TEXT],
      [s, 'surface', TEXT],
      [s, `${s}-soft`, TEXT], // icon and text inside the field
      ['fg', `${s}-soft`, TEXT], // the typed answer on the tinted field
      [s, `${s}-soft`, NON_TEXT], // the field border
    );
  }
  for (const t of ['unknown', 'learning']) {
    p.push(['fg', `token-${t}`, TEXT], [`token-${t}-line`, `token-${t}`, NON_TEXT]);
    p.push([`token-${t}-line`, 'bg', NON_TEXT], [`token-${t}-line`, 'surface', NON_TEXT]);
  }
  for (const c of CASES) {
    p.push(
      [`case-${c}`, 'bg', TEXT],
      [`case-${c}`, 'surface', TEXT],
      [`case-${c}`, `case-${c}-soft`, TEXT], // CaseBadge text on its tint
    );
  }
  return p;
}

describe('colour tokens', () => {
  it('both themes define the same tokens', () => {
    expect(Object.keys(dark).sort()).toEqual(
      Object.keys(light)
        .filter((k) => !/^(radius|tap|gutter|font|text|duration)/.test(k))
        .sort(),
    );
  });

  it('the system dark theme equals the forced dark theme', () => {
    expect(darkSystem).toEqual(dark);
  });

  it('gives every case its own colour', () => {
    for (const [, theme] of THEMES) {
      const colours = CASES.map((c) => theme[`case-${c}`]?.toLowerCase());
      expect(new Set(colours).size).toBe(CASES.length);
    }
  });

  it('keeps input text at 16 px or more and tap targets at 44 px or more', () => {
    const rem = (v: string | undefined) => Number.parseFloat(v ?? '0') * 16;
    expect(rem(light['text-input'])).toBeGreaterThanOrEqual(16);
    expect(rem(light['text-answer'])).toBeGreaterThanOrEqual(16);
    expect(rem(light.tap)).toBeGreaterThanOrEqual(44);
  });

  it('computes contrast correctly', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  for (const [name, theme] of THEMES) {
    it(`meets WCAG AA in the ${name} theme`, () => {
      const failures: string[] = [];
      for (const [fg, bg, min] of pairs()) {
        const a = theme[fg];
        const b = theme[bg];
        if (!a || !b) {
          failures.push(`missing token ${a ? bg : fg}`);
          continue;
        }
        const ratio = contrast(a, b);
        if (ratio < min) failures.push(`${fg} on ${bg}: ${ratio.toFixed(2)} < ${min}`);
      }
      expect(failures).toEqual([]);
    });
  }
});

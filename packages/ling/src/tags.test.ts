import { FormReadingSchema, FormTagSchema } from '@app/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  caseOfTag,
  formatTag,
  formatTags,
  parseTag,
  parseTags,
  readTag,
  readTags,
  tagOf,
  tryParseTag,
} from './tags';

const validTag = fc.oneof(
  fc.tuple(fc.constantFrom('s', 'p'), fc.integer({ min: 1, max: 7 })).map(([n, c]) => `${n}${c}`),
  fc
    .tuple(
      fc.constantFrom('s', 'p'),
      fc.integer({ min: 1, max: 7 }),
      fc.constantFrom('m', 'i', 'f', 'n'),
    )
    .map(([n, c, g]) => `${n}${c}${g}`),
  fc.integer({ min: 1, max: 7 }).map((c) => `x${c}`),
  fc.stringMatching(/^v:[A-Za-z+-]{0,8}$/).map((s) => s),
  fc.constant(''),
);

describe('form tags', () => {
  it('decodes nouns, agreeing words, pronouns, verbs and the empty tag', () => {
    expect(parseTag('s2')).toEqual({ kind: 'noun', number: 'sg', case: 'gen' });
    expect(parseTag('p4f')).toEqual({ kind: 'agree', number: 'pl', case: 'acc', gender: 'f' });
    expect(parseTag('s1m')).toEqual({ kind: 'agree', number: 'sg', case: 'nom', gender: 'm_anim' });
    expect(parseTag('s4i')).toEqual({ kind: 'agree', number: 'sg', case: 'acc', gender: 'm_inan' });
    expect(parseTag('x3')).toEqual({ kind: 'pron', case: 'dat' });
    expect(parseTag('v:Kesc+')).toEqual({ kind: 'verb', detail: 'Kesc+' });
    expect(parseTag('')).toEqual({ kind: 'none' });
  });

  it('numbers the cases as Slovak schools do', () => {
    expect(['1', '2', '3', '4', '5', '6', '7'].map((d) => caseOfTag(`s${d}`))).toEqual([
      'nom',
      'gen',
      'dat',
      'acc',
      'voc',
      'loc',
      'ins',
    ]);
    expect(caseOfTag('v:Kesc+')).toBeUndefined();
  });

  it('refuses what is not a form tag', () => {
    for (const bad of ['s8', 's0', 'q1', 'S2', 's2x', 'x', 'p4fm', ' s2', 'v', 'x2f']) {
      expect(tryParseTag(bad)).toBeNull();
      expect(() => parseTag(bad)).toThrow(RangeError);
    }
  });

  it('formats every tag back to itself, and agrees with the contract shape check', () => {
    fc.assert(
      fc.property(validTag, (tag) => {
        expect(formatTag(parseTag(tag))).toBe(tag);
        expect(FormTagSchema.safeParse(tag).success).toBe(true);
      }),
    );
  });

  it('parses and formats lists separated by spaces', () => {
    expect(parseTags('p1 p4 p5').map((t) => caseOfTag(formatTag(t)))).toEqual([
      'nom',
      'acc',
      'voc',
    ]);
    expect(parseTags('')).toEqual([]);
    expect(formatTags(parseTags('s2 p1 p4 p5'))).toBe('s2 p1 p4 p5');
  });

  it('builds a tag from features', () => {
    expect(tagOf({ case: 'gen', number: 'sg' })).toBe('s2');
    expect(tagOf({ case: 'acc', number: 'pl', gender: 'f' })).toBe('p4f');
    expect(tagOf({ case: 'ins', number: 'sg', gender: 'm_inan' })).toBe('s7i');
  });

  it('turns tags into case, number and gender as payloads carry them', () => {
    expect(readTag('s2')).toEqual({ tag: 's2', case: 'gen', number: 'sg' });
    expect(readTag('s2', 'n')).toEqual({ tag: 's2', case: 'gen', number: 'sg', gender: 'n' });
    expect(readTag('p4f')).toEqual({ tag: 'p4f', case: 'acc', number: 'pl', gender: 'f' });
    expect(readTag('x3')).toEqual({ tag: 'x3', case: 'dat' });
    expect(readTag('v:Kesc+')).toEqual({ tag: 'v:Kesc+' });
    expect(readTags('p1 p4 p5').map((r) => r.case)).toEqual(['nom', 'acc', 'voc']);
    fc.assert(
      fc.property(validTag, (tag) => {
        expect(FormReadingSchema.safeParse(readTag(tag, 'f')).success).toBe(true);
      }),
    );
  });
});

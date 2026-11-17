import { describe, expect, it } from 'vitest';
import { foldAscii, normalizeAnswer } from './text';

// Every letter of the Slovak alphabet that carries a diacritic, with its folded form.
const SLOVAK_ACCENTED: Record<string, string> = {
  á: 'a',
  ä: 'a',
  č: 'c',
  ď: 'd',
  é: 'e',
  í: 'i',
  ĺ: 'l',
  ľ: 'l',
  ň: 'n',
  ó: 'o',
  ô: 'o',
  ŕ: 'r',
  š: 's',
  ť: 't',
  ú: 'u',
  ý: 'y',
  ž: 'z',
};

describe('foldAscii', () => {
  it('folds Ľudia to ludia', () => {
    expect(foldAscii('Ľudia')).toBe('ludia');
  });

  it.each(Object.entries(SLOVAK_ACCENTED))('folds %s and its capital to %s', (letter, plain) => {
    expect(foldAscii(letter)).toBe(plain);
    expect(foldAscii(letter.toUpperCase())).toBe(plain);
  });

  it('covers all 17 accented Slovak letters', () => {
    expect(Object.keys(SLOVAK_ACCENTED)).toHaveLength(17);
  });

  it('leaves plain letters and the digraphs alone, lower cased', () => {
    expect(foldAscii('ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBe('abcdefghijklmnopqrstuvwxyz');
    expect(foldAscii('Dz Dž Ch')).toBe('dz dz ch');
  });

  it('folds whole words of the mini dataset', () => {
    expect(foldAscii('vysvedčenie')).toBe('vysvedcenie');
    expect(foldAscii('Pomáhať')).toBe('pomahat');
    expect(foldAscii('päť')).toBe('pat');
    expect(foldAscii('môj')).toBe('moj');
    expect(foldAscii('dlaň')).toBe('dlan');
    expect(foldAscii('mestá')).toBe(foldAscii('mesta'));
  });

  it('folds decomposed input the same as precomposed input', () => {
    expect(foldAscii('žena')).toBe('zena');
  });
});

describe('normalizeAnswer', () => {
  it('trims, joins spaces, lower cases and drops a final stop', () => {
    expect(normalizeAnswer('  Nové   Mesto. ')).toBe('nové mesto');
    expect(normalizeAnswer('Kde?')).toBe('kde');
    expect(normalizeAnswer('Nie!')).toBe('nie');
  });

  it('keeps accents and inner punctuation', () => {
    expect(normalizeAnswer('Mestá')).toBe('mestá');
    expect(normalizeAnswer('a, nie')).toBe('a, nie');
  });

  it('drops only one final mark', () => {
    expect(normalizeAnswer('dnes?!')).toBe('dnes?');
  });

  it('composes decomposed accents', () => {
    expect(normalizeAnswer('žene')).toBe('žene');
  });
});

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { splitSentences, tokenize } from './text';

const SPACE = /\s/u;

/** Pieces that make strings hard: accents, decomposed marks, emoji, odd spaces, lone halves. */
const TRICKY_UNITS = [
  'a',
  'ž',
  'Ľ',
  'ô',
  'ä',
  'ž',
  '́',
  'Ž',
  '1',
  '0',
  '٣',
  '½',
  '.',
  ',',
  '!',
  '?',
  '…',
  '„',
  '“',
  '-',
  '–',
  "'",
  '(',
  ' ',
  '  ',
  ' ',
  ' ',
  '\n',
  '\n\n',
  '\t',
  '\r\n',
  ' ',
  '﻿',
  '​',
  '‍',
  '😀',
  '👍🏽',
  '🇸🇰',
  'ﬁ',
  '\ud800',
  '\udc00',
  'napr.',
  'Ing.',
  '1. ',
  'IV. ',
  'mája',
  'Mesto',
];

const tricky = fc.oneof(
  fc.array(fc.constantFrom(...TRICKY_UNITS), { maxLength: 40 }).map((a) => a.join('')),
  fc.string({ unit: 'binary', maxLength: 40 }),
  fc.string({ unit: 'grapheme', maxLength: 40 }),
);

function nonSpace(text: string): string {
  return [...text].filter((c) => !SPACE.test(c)).join('');
}

describe('tokenize', () => {
  it('keeps character offsets into the text as given', () => {
    const text = 'Idem do mesta, 17. 11. 2026 o 10.30 hod.!';
    const tokens = tokenize(text);
    expect(tokens.map((t) => [text.slice(t.s, t.e), t.t])).toEqual([
      ['Idem', 'word'],
      ['do', 'word'],
      ['mesta', 'word'],
      [',', 'punct'],
      ['17', 'num'],
      ['.', 'punct'],
      ['11', 'num'],
      ['.', 'punct'],
      ['2026', 'num'],
      ['o', 'word'],
      ['10.30', 'num'],
      ['hod', 'word'],
      ['.', 'punct'],
      ['!', 'punct'],
    ]);
  });

  it('keeps decomposed accents inside the word and emoji whole', () => {
    const text = 'žena 👍🏽 3,5';
    expect(tokenize(text).map((t) => [text.slice(t.s, t.e), t.t])).toEqual([
      ['žena', 'word'],
      ['👍', 'punct'],
      ['🏽', 'punct'],
      ['3,5', 'num'],
    ]);
  });

  it('gives slices that are exactly the tokens, on tricky strings', () => {
    fc.assert(
      fc.property(tricky, (text) => {
        const tokens = tokenize(text);
        let last = 0;
        for (const tok of tokens) {
          expect(tok.s).toBeGreaterThanOrEqual(last);
          expect(tok.e).toBeGreaterThan(tok.s);
          expect(tok.e).toBeLessThanOrEqual(text.length);
          last = tok.e;
          const slice = text.slice(tok.s, tok.e);
          // The slice holds no white space and is one token of the same type on its own.
          expect(SPACE.test(slice)).toBe(false);
          expect(tokenize(slice)).toEqual([{ s: 0, e: slice.length, t: tok.t }]);
          if (tok.t === 'word') expect(slice).toMatch(/^\p{L}[\p{L}\p{M}]*$/u);
          if (tok.t === 'num') expect(slice).toMatch(/^\p{N}+(?:[.,]\p{N}+)*$/u);
        }
        // Nothing but white space falls between tokens.
        expect(tokens.map((t) => text.slice(t.s, t.e)).join('')).toBe(nonSpace(text));
      }),
      { numRuns: 2000 },
    );
  });
});

describe('splitSentences', () => {
  const cases: [string, string[]][] = [
    ['Ahoj. Ako sa máš? Mám sa dobre!', ['Ahoj.', 'Ako sa máš?', 'Mám sa dobre!']],
    [
      'Narodil sa 1. mája 1990 v Bratislave. Potom sa presťahoval.',
      ['Narodil sa 1. mája 1990 v Bratislave.', 'Potom sa presťahoval.'],
    ],
    ['V 21. storočí žijeme inak. Áno.', ['V 21. storočí žijeme inak.', 'Áno.']],
    [
      'Prišiel Ing. Novák a napr. Mgr. Kováčová. Bolo to pekné.',
      ['Prišiel Ing. Novák a napr. Mgr. Kováčová.', 'Bolo to pekné.'],
    ],
    [
      'Prišiel jeho brat, t. j. Peter. Potom odišli.',
      ['Prišiel jeho brat, t. j. Peter.', 'Potom odišli.'],
    ],
    ['Karol IV. Luxemburský bol kráľ. Áno.', ['Karol IV. Luxemburský bol kráľ.', 'Áno.']],
    [
      'Stretnutie bude 17. 11. 2026 o 10.00. Príďte včas.',
      ['Stretnutie bude 17. 11. 2026 o 10.00.', 'Príďte včas.'],
    ],
    ['„Poď sem!“ zakričal Peter. Prišiel som.', ['„Poď sem!“ zakričal Peter.', 'Prišiel som.']],
    [
      'Kúpil jablká, hrušky atď. Potom išiel domov.',
      ['Kúpil jablká, hrušky atď.', 'Potom išiel domov.'],
    ],
    ['Bolo to v r. 1990 v meste sv. Martin.', ['Bolo to v r. 1990 v meste sv. Martin.']],
    ['Čakal som... A potom prišiel.', ['Čakal som...', 'A potom prišiel.']],
    ['Nadpis\nPrvá veta. Druhá veta.', ['Nadpis', 'Prvá veta.', 'Druhá veta.']],
    ['Prvý odsek\n\nDruhý odsek', ['Prvý odsek', 'Druhý odsek']],
    ['Toto je veta,\nktorá pokračuje. Koniec.', ['Toto je veta,\nktorá pokračuje.', 'Koniec.']],
    ['1. Úvod\nText začína tu.', ['1. Úvod', 'Text začína tu.']],
    ['Pozri www.sme.sk a číslo 3.14. Super.', ['Pozri www.sme.sk a číslo 3.14.', 'Super.']],
    ['Je to 5 km. Potom pôjdeme.', ['Je to 5 km.', 'Potom pôjdeme.']],
    ['Prečo?! Neviem.', ['Prečo?!', 'Neviem.']],
    ['  Bez bodky na konci  ', ['Bez bodky na konci']],
    ['', []],
    [' \n\t ', []],
  ];

  it.each(cases)('splits %j', (text, expected) => {
    expect(splitSentences(text).map((s) => text.slice(s.start, s.end))).toEqual(expected);
  });

  it('gives trimmed spans in order that hold every character but white space', () => {
    fc.assert(
      fc.property(tricky, (text) => {
        const spans = splitSentences(text);
        let last = 0;
        for (const span of spans) {
          expect(span.start).toBeGreaterThanOrEqual(last);
          expect(span.end).toBeGreaterThan(span.start);
          expect(span.end).toBeLessThanOrEqual(text.length);
          last = span.end;
          expect(SPACE.test(text[span.start] as string)).toBe(false);
          expect(SPACE.test(text[span.end - 1] as string)).toBe(false);
        }
        expect(nonSpace(spans.map((s) => text.slice(s.start, s.end)).join(''))).toBe(
          nonSpace(text),
        );
      }),
      { numRuns: 2000 },
    );
  });

  it('never cuts a token in two', () => {
    fc.assert(
      fc.property(tricky, (text) => {
        const spans = splitSentences(text);
        for (const tok of tokenize(text)) {
          const inside = spans.some((s) => s.start <= tok.s && tok.e <= s.end);
          expect(inside).toBe(true);
        }
      }),
      { numRuns: 1000 },
    );
  });
});

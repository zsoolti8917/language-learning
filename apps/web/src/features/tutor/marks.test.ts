import { describe, expect, it } from 'vitest';
import { locateMark, splitMarks } from './marks';

const mark = (text: string, word: string, id = word, from = 0) => {
  const start = text.indexOf(word, from);
  return { id, start, end: start + word.length, given: word };
};

describe('error marks', () => {
  it('cover exactly the given characters in a sentence full of accents', () => {
    const text = 'Včera som sa stretol s kamarát v kaviarni na námestí.';
    const m1 = mark(text, 'kamarát');
    const segs = splitMarks(text, [m1]);
    expect(segs.map((s) => s.text)).toEqual([
      'Včera som sa stretol s ',
      'kamarát',
      ' v kaviarni na námestí.',
    ]);
    expect(segs[1]).toMatchObject({ start: 23, end: 30, mark: m1 });
    expect(segs.map((s) => s.text).join('')).toBe(text);
  });

  it('places two marks after accented letters at the right offsets', () => {
    const text = 'Ľúbim ísť do mesto s môj brat.';
    const a = mark(text, 'mesto');
    const b = mark(text, 'môj');
    const segs = splitMarks(text, [b, a]);
    expect(segs.filter((s) => s.mark).map((s) => [s.text, s.start, s.end])).toEqual([
      ['mesto', 13, 18],
      ['môj', 21, 24],
    ]);
  });

  it('moves to the given word when the offsets do not match the text', () => {
    // Offsets counted on a decomposed (NFD) copy run one character long per accent.
    const text = 'Dnes idem do kina s kamarát.';
    const nfd = text.normalize('NFD');
    const start = nfd.indexOf('kamara');
    const off = {
      id: 'x',
      start,
      end: start + 'kamarát'.normalize('NFD').length,
      given: 'kamarát',
    };
    expect(locateMark(text, off)).toEqual({ start: 20, end: 27 });
  });

  it('takes the occurrence nearest to the offsets when a word repeats', () => {
    const text = 'mesto, mesto, mesto';
    expect(locateMark(text, { id: 'x', start: 13, end: 17, given: 'mesto' })).toEqual({
      start: 14,
      end: 19,
    });
  });

  it('keeps the text whole and leaves out overlapping or empty marks', () => {
    const text = 'Idem s kamarát.';
    const segs = splitMarks(text, [
      { id: 'a', start: 7, end: 14, given: 'kamarát' },
      { id: 'b', start: 9, end: 12, given: 'mar' },
      { id: 'c', start: 3, end: 3, given: '' },
    ]);
    expect(segs.map((s) => s.text).join('')).toBe(text);
    expect(segs.filter((s) => s.mark).map((s) => s.mark?.id)).toEqual(['a']);
  });

  it('returns the plain text when there are no marks', () => {
    expect(splitMarks('Ahoj!', [])).toEqual([{ text: 'Ahoj!', start: 0, end: 5 }]);
    expect(splitMarks('', [])).toEqual([{ text: '', start: 0, end: 0 }]);
  });
});

import { FormMapSchema } from '@app/contracts';
import { describe, expect, it } from 'vitest';
import { ENDINGS, MESTO, PEKNY, ULICA, ZENA } from './fixtures/tables';
import { buildFormMap, findStem, formsWithTag, stemOf } from './forms';

describe('buildFormMap', () => {
  it('maps every form of mesto to its tags', () => {
    const map = buildFormMap(MESTO);
    expect(FormMapSchema.parse(map)).toEqual(map);
    expect(map.mesta).toEqual(['s2']);
    expect(map.mestá).toEqual(['p1', 'p4', 'p5']);
    expect(map.miest).toEqual(['p2']);
    expect(Object.keys(map)).toHaveLength(10);
  });

  it('merges the rows of one form, as the SNK table has one row per reading', () => {
    const map = buildFormMap(PEKNY);
    expect(map.pekného).toEqual(['s2m', 's4m', 's2i', 's2n']);
    expect(map.pekné).toEqual([
      'p1i',
      'p4i',
      'p5i',
      'p1f',
      'p4f',
      'p5f',
      's1n',
      's4n',
      's5n',
      'p1n',
      'p4n',
      'p5n',
    ]);
    expect(Object.keys(map)).toHaveLength(13);
  });

  it('lower cases keys, keeps NFC, and does not repeat tags', () => {
    const map = buildFormMap([
      { form: 'Ulica', tags: 's1' },
      { form: 'ulica', tags: ['s1', 's5'] },
      { form: 'žena', tags: 's1' },
    ]);
    expect(map).toEqual({ ulica: ['s1', 's5'], žena: ['s1'] });
  });

  it('refuses an invalid tag', () => {
    expect(() => buildFormMap([{ form: 'mesto', tags: 'SSns1' }])).toThrow(RangeError);
  });

  it('lists the forms that carry a tag', () => {
    expect(formsWithTag(buildFormMap(ZENA), 'p4')).toEqual(['ženy']);
    expect(formsWithTag(buildFormMap(PEKNY), 's2f')).toEqual(['peknej']);
  });
});

describe('stems', () => {
  it('strips the ending a pattern has for a tag', () => {
    expect(findStem('ulice', 's2', ENDINGS.ulica)).toBe('ulic');
    expect(findStem('ženám', 'p3', ENDINGS.zena)).toBe('žen');
    expect(findStem('miest', 'p2', ENDINGS.mesto)).toBe('miest');
    expect(findStem('ulice', 's2', ENDINGS.zena)).toBeNull();
    expect(findStem('ulice', 's9', ENDINGS.zena)).toBeNull();
  });

  it('finds the stem most forms agree on', () => {
    expect(stemOf(buildFormMap(MESTO), ENDINGS.mesto)).toBe('mest');
    expect(stemOf(buildFormMap(ZENA), ENDINGS.zena)).toBe('žen');
    expect(stemOf(buildFormMap(ULICA), ENDINGS.ulica)).toBe('ulic');
    expect(stemOf({}, ENDINGS.ulica)).toBeNull();
  });
});

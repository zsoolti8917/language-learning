import { DIAGNOSES, ErrorTypeSchema } from '@app/contracts';
import { describe, expect, it } from 'vitest';
import { diagnoseForm, errorTypeFor } from './diagnose';
import { ENDINGS, MESTO, ULICA, ZENA } from './fixtures/tables';
import { buildFormMap, stemOf } from './forms';

const mesto = buildFormMap(MESTO);
const zena = buildFormMap(ZENA);
const ulica = buildFormMap(ULICA);

/** Feminine patterns and the ending each has for s2. */
const S2_FEMININE = { zena: 'y', ulica: 'e', dlan: 'e', kost: 'i', gazdina: 'ej' };

describe('diagnoseForm', () => {
  it('correct: matches an accepted answer after normalising', () => {
    expect(diagnoseForm('mesta', { answers: ['mesta'], formMap: mesto })).toEqual({
      diagnosis: 'correct',
      answer: 'mesta',
    });
    expect(diagnoseForm('  Mesta. ', { answers: ['mesta'], formMap: mesto }).diagnosis).toBe(
      'correct',
    );
    // A decomposed accent from a phone keyboard.
    expect(diagnoseForm('ženám', { answers: ['ženám'], formMap: zena }).diagnosis).toBe('correct');
  });

  it('other_case: "do meste" names the locative where do takes the genitive', () => {
    const result = diagnoseForm('meste', { answers: ['mesta'], formMap: mesto, gender: 'n' });
    expect(result).toEqual({
      diagnosis: 'other_case',
      form: 'meste',
      tags: ['s6'],
      readings: [{ tag: 's6', case: 'loc', number: 'sg', gender: 'n' }],
    });
    expect(errorTypeFor(result.diagnosis, { triggerKind: 'preposition', expectedTag: 's2' })).toBe(
      'case_after_preposition',
    );
  });

  it('other_case: mesta and mestá are different forms, not an accent slip', () => {
    const genForNom = diagnoseForm('mesta', { answers: ['mestá'], formMap: mesto });
    expect(genForNom).toMatchObject({ diagnosis: 'other_case', form: 'mesta', tags: ['s2'] });
    const nomForGen = diagnoseForm('mestá', { answers: ['mesta'], formMap: mesto });
    expect(nomForGen).toMatchObject({
      diagnosis: 'other_case',
      form: 'mestá',
      tags: ['p1', 'p4', 'p5'],
    });
    if (nomForGen.diagnosis !== 'other_case') throw new Error('unreachable');
    expect(nomForGen.readings.map((r) => r.case)).toEqual(['nom', 'acc', 'voc']);
  });

  it('diacritics: zenam for ženám', () => {
    const result = diagnoseForm('zenam', { answers: ['ženám'], formMap: zena });
    expect(result).toEqual({ diagnosis: 'diacritics', answer: 'ženám' });
    expect(errorTypeFor(result.diagnosis)).toBe('spelling');
    // Accents put on the wrong letter count the same.
    expect(diagnoseForm('žénam', { answers: ['ženám'], formMap: zena }).diagnosis).toBe(
      'diacritics',
    );
  });

  it('wrong_pattern: "z ulicy" borrows the ending of žena', () => {
    const item = {
      answers: ['ulice'],
      formMap: ulica,
      siblingEndings: S2_FEMININE,
      pattern: 'ulica',
    };
    const result = diagnoseForm('ulicy', item);
    expect(result).toEqual({ diagnosis: 'wrong_pattern', pattern: 'zena', ending: 'y' });
    expect(errorTypeFor(result.diagnosis, { expectedTag: 's2' })).toBe('pattern_ending');
    expect(diagnoseForm('ulicej', item)).toMatchObject({ pattern: 'gazdina' });
    // Without the own pattern, the stem is guessed from the accepted answer.
    expect(
      diagnoseForm('ulicy', { answers: ['ulice'], formMap: ulica, siblingEndings: S2_FEMININE }),
    ).toEqual({ diagnosis: 'wrong_pattern', pattern: 'zena', ending: 'y' });
    // ulici is a real form (s3, s6), so it is another case before it is kosť's ending.
    expect(diagnoseForm('ulici', item).diagnosis).toBe('other_case');
  });

  it('wrong_pattern in the genitive plural, with the stem from the pattern', () => {
    const stem = stemOf(zena, ENDINGS.zena);
    expect(stem).toBe('žen');
    const result = diagnoseForm('ženov', {
      answers: ['žien'],
      formMap: zena,
      siblingEndings: { zena: '', chlap: 'ov', dub: 'ov' },
      pattern: 'zena',
      stem: stem ?? undefined,
    });
    expect(result).toEqual({ diagnosis: 'wrong_pattern', pattern: 'chlap', ending: 'ov' });
    expect(errorTypeFor(result.diagnosis, { expectedTag: 'p2' })).toBe('genitive_plural');
  });

  it('not_a_form: anything else, and an empty answer', () => {
    expect(diagnoseForm('domu', { answers: ['mesta'], formMap: mesto })).toEqual({
      diagnosis: 'not_a_form',
    });
    expect(diagnoseForm('ulicy', { answers: ['ulice'], formMap: ulica }).diagnosis).toBe(
      'not_a_form',
    );
    expect(diagnoseForm('   ', { answers: ['mesta'], formMap: mesto }).diagnosis).toBe(
      'not_a_form',
    );
  });

  it('runs in the specified order: an exact form of the word wins over an accent match', () => {
    // mestá folds to mesta, the answer, but is a real form: other_case, not diacritics.
    expect(diagnoseForm('mestá', { answers: ['mesta'], formMap: mesto }).diagnosis).toBe(
      'other_case',
    );
    // A form that is also an accepted answer is correct.
    expect(diagnoseForm('ženy', { answers: ['ženy'], formMap: zena }).diagnosis).toBe('correct');
  });
});

describe('errorTypeFor', () => {
  it('maps every diagnosis to a value of the shared error list', () => {
    for (const d of DIAGNOSES) {
      const t = errorTypeFor(d);
      if (d === 'correct') expect(t).toBeNull();
      else expect(ErrorTypeSchema.parse(t)).toBe(t);
    }
  });

  it('names the case error by the kind of trigger', () => {
    expect(errorTypeFor('other_case', { triggerKind: 'verb' })).toBe('case_after_verb');
    expect(errorTypeFor('other_case', { triggerKind: 'numeral' })).toBe('case_after_numeral');
    expect(errorTypeFor('other_case', { triggerKind: 'question' })).toBe('case_other');
    expect(errorTypeFor('other_case')).toBe('case_other');
    expect(errorTypeFor('wrong_pattern')).toBe('pattern_ending');
    expect(errorTypeFor('not_a_form')).toBe('other');
  });
});

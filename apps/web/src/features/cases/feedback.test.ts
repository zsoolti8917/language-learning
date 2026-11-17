import type { ExerciseItem } from '@app/contracts';
import { describe, expect, it } from 'vitest';
import { answerPhrase, grade, plainText } from './feedback';
import { EX_BRATOVI, EX_KINE, EX_KNIHU, EX_MESTA, EX_ULICE, EX_ZENAM, EX_ZENU } from './fixtures';
import { accentSlips, capitalize, triggerWord, wordBefore } from './grammar';

const hint = (item: ExerciseItem, typed: string) => plainText(grade(item, typed).hint);
const full = (item: ExerciseItem, typed: string) => plainText(grade(item, typed).feedback);

describe('feedback for each diagnosis', () => {
  it('do meste: another case, named with the trigger', () => {
    const g = grade(EX_MESTA, 'meste');
    expect(g).toMatchObject({
      diagnosis: 'other_case',
      errorType: 'case_after_preposition',
      correct: false,
      state: 'wrong',
    });
    expect(plainText(g.hint)).toBe('That is the locative singular. After do comes the genitive.');
    expect(plainText(g.feedback)).toBe(
      'That is the locative singular. After do comes the genitive: do mesta.',
    );
  });

  it('zenam: the accents, with the letters to watch', () => {
    const g = grade(EX_ZENAM, 'zenam');
    expect(g).toMatchObject({ diagnosis: 'diacritics', errorType: 'spelling', state: 'close' });
    expect(plainText(g.hint)).toBe('The letters are right, but the accents are not. Watch ž, á.');
    expect(plainText(g.feedback)).toBe('The letters are right, but the accents are not: ženám.');
  });

  it('z ulicy: an ending borrowed from the hard pattern žena', () => {
    const g = grade(EX_ULICE, 'ulicy');
    expect(g).toMatchObject({
      diagnosis: 'wrong_pattern',
      errorType: 'pattern_ending',
      patternId: 'ulica',
    });
    expect(plainText(g.hint)).toBe(
      'Ulica is a soft noun. The ending -y belongs to hard nouns like žena.',
    );
    expect(plainText(g.feedback)).toBe(
      'Ulica is a soft noun: z ulice. The ending -y belongs to hard nouns like žena.',
    );
  });

  it('never shows the answer before the retry', () => {
    for (const [item, typed] of [
      [EX_MESTA, 'meste'],
      [EX_MESTA, 'mestá'],
      [EX_ZENAM, 'zenam'],
      [EX_ULICE, 'ulicy'],
      [EX_ULICE, 'ulici'],
      [EX_BRATOVI, 'brata'],
      [EX_KINE, 'kina'],
      [EX_KNIHU, 'knihy'],
      [EX_MESTA, 'mestou'],
    ] as const) {
      expect(hint(item, typed)).not.toContain(item.answers[0] as string);
      expect(full(item, typed)).toContain(item.answers[0] as string);
    }
  });

  it('names every reading of an ambiguous form, without the vocative', () => {
    expect(full(EX_MESTA, 'mestá')).toBe(
      'That form can be the nominative plural or accusative plural. After do comes the genitive: do mesta.',
    );
    expect(full(EX_ZENAM, 'ženy')).toBe(
      'That form can be the genitive singular, nominative plural or accusative plural. After pomáhať comes the dative: ženám.',
    );
  });

  it('adds the number when only the number is wrong', () => {
    expect(full(EX_ZENAM, 'žene')).toBe(
      'That form can be the dative singular or locative singular. After pomáhať comes the dative plural: ženám.',
    );
  });

  it('uses the verb and question triggers, and plain wording without a trigger', () => {
    expect(grade(EX_BRATOVI, 'brata').errorType).toBe('case_after_verb');
    expect(full(EX_BRATOVI, 'brata')).toBe(
      'That form can be the genitive singular or accusative singular. After pomáhať comes the dative: bratovi.',
    );
    expect(grade(EX_ZENU, 'žene').errorType).toBe('case_other');
    expect(full(EX_ZENU, 'žene')).toBe(
      'That form can be the dative singular or locative singular. This sentence needs the accusative: ženu.',
    );
  });

  it('not a form: says so and gives the case and the answer', () => {
    const g = grade(EX_MESTA, 'mestou');
    expect(g).toMatchObject({ diagnosis: 'not_a_form', errorType: 'other' });
    expect(plainText(g.feedback)).toBe(
      'mestou is not a form of mesto. After do comes the genitive: do mesta.',
    );
  });

  it('a correct answer, also with capitals and a full stop', () => {
    expect(grade(EX_MESTA, ' Mesta. ')).toMatchObject({ diagnosis: 'correct', correct: true });
    expect(full(EX_KINE, 'kine')).toBe('Right: v kine.');
  });

  it('wrong pattern without a hard and soft pair: "declines like"', () => {
    // brat follows chlap; -mu is the dative ending of kuli, a pattern without a soft pair.
    const g = grade(EX_BRATOVI, 'bratmu');
    expect(g.diagnosis).toBe('wrong_pattern');
    expect(plainText(g.feedback)).toBe(
      'Brat declines like chlap: bratovi. The ending -mu belongs to words like kuli.',
    );
  });

  it('choice of meaning: points at the form and gives the meaning', () => {
    const item: ExerciseItem = {
      ...EX_ZENU,
      kind: 'choice_meaning',
      options: [
        { text: 'I see a woman.', correct: true },
        { text: 'A woman sees me.', correct: false },
      ],
    };
    const g = grade(item, 'A woman sees me.');
    expect(g.correct).toBe(false);
    expect(plainText(g.hint)).toBe('Look at ženu: it is the accusative here.');
    expect(plainText(g.feedback)).toBe(
      'Look at ženu: it is the accusative here. It means: I see a woman.',
    );
    expect(grade(item, 'I see a woman.').correct).toBe(true);
  });
});

describe('helpers', () => {
  it('builds the phrase with the trigger word before the gap', () => {
    expect(answerPhrase(EX_MESTA)).toBe('do mesta');
    expect(answerPhrase(EX_ULICE)).toBe('z ulice');
    expect(answerPhrase(EX_BRATOVI)).toBe('bratovi');
    expect(answerPhrase(EX_KNIHU)).toBe('knihu');
  });

  it('reads trigger words, the word before a gap, capitals and accent slips', () => {
    expect(triggerWord('do + genitive')).toBe('do');
    expect(triggerWord('pomáhať + dative')).toBe('pomáhať');
    expect(wordBefore('Idem do mesta.', 8)).toBe('do');
    expect(wordBefore('Mesto je pekné.', 0)).toBeNull();
    expect(capitalize('žena')).toBe('Žena');
    expect(accentSlips('zenam', 'ženám')).toEqual(['ž', 'á']);
    expect(accentSlips('žénam', 'ženám')).toEqual(['á']);
    expect(accentSlips('zena', 'ženám')).toEqual([]);
  });
});

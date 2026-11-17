// Items and the server's diagnosis, on the mini dataset in memory.
import { type Case, ExerciseItemSchema, type Gender, type GrammaticalNumber } from '@app/contracts';
import { loadMini } from '@app/testkit/mini';
import { describe, expect, it } from 'vitest';
import {
  buildExerciseItem,
  diagnoseAnswer,
  type ExerciseData,
  expectedTagOf,
  type ItemData,
  triggerLabel,
} from './items';

const mini = loadMini();

const data: ItemData = {
  forms: new Map([...mini.formsByLemma].map(([id, rows]) => [id, rows.map((r) => ({ ...r }))])),
  lemmas: new Map(
    [...mini.lemmaById.values()].map((l) => [
      l.id,
      { id: l.id, lemma: l.lemma, pos: l.pos, gender: l.gender ?? null },
    ]),
  ),
  patterns: [...mini.patternById.values()].map((p) => ({
    id: p.id,
    pos: p.pos,
    gender: p.gender ?? null,
    endings: p.endings,
  })),
  triggers: new Map(
    [...mini.triggerById.values()].map((t) => [
      t.id,
      { id: t.id, kind: t.kind, lemma: t.lemma, case: t.case },
    ]),
  ),
};

function fromMini(id: string): ExerciseData {
  const r = mini.exerciseById.get(id);
  if (!r) throw new Error(id);
  return {
    id: r.id,
    kind: r.kind,
    sentenceSk: r.sentenceSk,
    sentenceEn: r.sentenceEn,
    target: r.target,
    case: r.case,
    number: r.number,
    gender: r.gender,
    pattern: r.pattern ?? null,
    triggerId: r.triggerId ?? null,
    options: r.options ?? null,
    lessonId: r.lessonId ?? null,
  };
}

/** A typed gap made up for a test, on a word of the mini dataset. */
function gap(
  sentenceSk: string,
  answer: string,
  lemmaId: number,
  f: { case: Case; number: GrammaticalNumber; gender: Gender; pattern: string; triggerId: string },
): ExerciseData {
  const start = sentenceSk.indexOf(answer);
  return {
    id: 'ex-0000000000',
    kind: 'cloze',
    sentenceSk,
    sentenceEn: '',
    target: { start, end: start + answer.length, lemmaIds: [lemmaId], cue: '', answers: [answer] },
    case: f.case,
    number: f.number,
    gender: f.gender,
    pattern: f.pattern,
    triggerId: f.triggerId,
    options: null,
    lessonId: null,
  };
}

describe('exercise items', () => {
  it('builds the item of every mini exercise, valid by the contract', () => {
    for (const id of mini.exerciseById.keys()) {
      const item = buildExerciseItem(fromMini(id), data);
      ExerciseItemSchema.parse(item);
      const right =
        item.kind === 'choice_meaning'
          ? (item.options?.find((o) => o.correct)?.text as string)
          : (item.answers[0] as string);
      expect(diagnoseAnswer(item, right).diagnosis).toBe('correct');
    }
  });

  it('carries the form map, the trigger label and the endings of sibling patterns', () => {
    const item = buildExerciseItem(fromMini('ex-7b21c0d4e9'), data);
    expect(item.formMap.mesta).toEqual(['s2']);
    expect(item.formMap.mestá).toEqual(['p1', 'p4', 'p5']);
    expect(item.trigger).toEqual({ id: 'prep-do', kind: 'preposition', label: 'do + genitive' });
    expect(item.siblingEndings).toEqual({
      mesto: 'a',
      srdce: 'a',
      vysvedcenie: 'ia',
      dievca: 'aťa',
    });
    // Masculine patterns are one family, animate or not.
    const brat = buildExerciseItem(fromMini('ex-b4e1f09a37'), data);
    expect(Object.keys(brat.siblingEndings ?? {}).sort()).toEqual([
      'chlap',
      'dub',
      'hrdina',
      'kuli',
      'stroj',
    ]);
    expect(triggerLabel({ lemma: 'pomáhať', case: 'dat' })).toBe('pomáhať + dative');
  });

  it('gives a phrase the forms of the whole phrase', () => {
    const item = buildExerciseItem(fromMini('ex-4fffb3db0d'), data); // Mám novú prácu.
    expect(item.formMap['novú prácu']).toEqual(['s4']);
    expect(item.formMap['novej práce']).toEqual(['s2']);
    expect(item.siblingEndings).toBeUndefined();
    const d = diagnoseAnswer(item, 'nová práca');
    expect(d).toMatchObject({ correct: false, diagnosis: 'other_case', givenCase: 'nom' });
    expect(expectedTagOf({ answers: item.answers, ...item.features }, item.formMap)).toBe('s4');
  });

  it('keeps choice options and grades a meaning choice by its text', () => {
    const item = buildExerciseItem(fromMini('ex-95b51f9ebd'), data);
    expect(item.options).toHaveLength(3);
    expect(diagnoseAnswer(item, 'My friend sees my brother.')).toMatchObject({
      correct: true,
      diagnosis: 'correct',
    });
    expect(diagnoseAnswer(item, 'My brother sees my friend.')).toEqual({
      correct: false,
      diagnosis: null,
      errorType: 'case_other',
      givenCase: null,
    });
  });
});

describe('the three examples of the Declension engine section', () => {
  it('do meste: other_case after a preposition', () => {
    const item = buildExerciseItem(fromMini('ex-7b21c0d4e9'), data); // Idem do mesta.
    expect(diagnoseAnswer(item, 'meste')).toEqual({
      correct: false,
      diagnosis: 'other_case',
      errorType: 'case_after_preposition',
      givenCase: 'loc',
    });
  });

  it('zenam for ženám: diacritics, a spelling error', () => {
    const item = buildExerciseItem(
      gap('Pomáham ženám.', 'ženám', 11, {
        case: 'dat',
        number: 'pl',
        gender: 'f',
        pattern: 'zena',
        triggerId: 'verb-pomahat',
      }),
      data,
    );
    expect(diagnoseAnswer(item, 'zenam')).toEqual({
      correct: false,
      diagnosis: 'diacritics',
      errorType: 'spelling',
      givenCase: null,
    });
  });

  it('z ulicy: an ending borrowed from žena, a pattern error', () => {
    const item = buildExerciseItem(
      gap('Idem z ulice.', 'ulice', 14, {
        case: 'gen',
        number: 'sg',
        gender: 'f',
        pattern: 'ulica',
        triggerId: 'prep-z',
      }),
      data,
    );
    expect(diagnoseAnswer(item, 'ulicy')).toEqual({
      correct: false,
      diagnosis: 'wrong_pattern',
      errorType: 'pattern_ending',
      givenCase: null,
    });
  });

  it('a borrowed genitive plural ending is a genitive_plural error, other words not_a_form', () => {
    const item = buildExerciseItem(
      gap('Vidím päť žien.', 'žien', 11, {
        case: 'gen',
        number: 'pl',
        gender: 'f',
        pattern: 'zena',
        triggerId: 'num-pat',
      }),
      data,
    );
    expect(diagnoseAnswer(item, 'žieni')).toMatchObject({
      diagnosis: 'wrong_pattern',
      errorType: 'genitive_plural',
    });
    expect(diagnoseAnswer(item, 'stôl')).toMatchObject({
      diagnosis: 'not_a_form',
      errorType: 'other',
    });
  });
});

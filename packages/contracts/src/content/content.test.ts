import { describe, expect, it } from 'vitest';
import {
  CONTENT_FILES,
  ExerciseRowSchema,
  FormRowSchema,
  LemmaRowSchema,
  LessonRowSchema,
  ManifestSchema,
  PatternRowSchema,
  SentenceRowSchema,
} from './index';

describe('content rows', () => {
  it('has a schema for each of the ten jsonl files', () => {
    expect(Object.keys(CONTENT_FILES).sort()).toEqual(
      [
        'exercises',
        'forms',
        'lemmas',
        'lessons',
        'library',
        'patterns',
        'scenarios',
        'senses',
        'sentences',
        'triggers',
      ].map((f) => `${f}.jsonl`),
    );
  });

  it('parses a lemma and fills defaults', () => {
    const row = LemmaRowSchema.parse({
      id: 20,
      key: 'mesto|noun|n|1',
      lemma: 'mesto',
      pos: 'noun',
      gender: 'n',
      pattern: 'mesto',
      freqRank: 152,
    });
    expect(row.topForms).toEqual([]);
    expect(row.flags).toEqual({});
    expect(LemmaRowSchema.safeParse({ ...row, key: 'mesto' }).success).toBe(false);
  });

  it('checks form tags', () => {
    for (const tags of ['s2', 'p1 p4 p5', 'p4f', 'x3', 'v:Kesc+', ''])
      expect(FormRowSchema.safeParse({ lemmaId: 20, form: 'mestá', tags }).success, tags).toBe(
        true,
      );
    for (const tags of ['s8', 'q1', 'p1  p4', ' s2', 's2 '])
      expect(FormRowSchema.safeParse({ lemmaId: 20, form: 'mestá', tags }).success, tags).toBe(
        false,
      );
  });

  it('parses a sentence with its links', () => {
    const row = SentenceRowSchema.parse({
      id: 'tat-482913',
      textSk: 'Idem do mesta.',
      textEn: 'I am going to town.',
      tokens: [
        { s: 0, e: 4, lemmaId: 62, tag: 'v:Kesa+' },
        { s: 5, e: 7, lemmaId: 45 },
        { s: 8, e: 13, lemmaId: 20, tag: 's2' },
        { s: 13, e: 14 },
      ],
      difficulty: 0.1,
      source: 'tatoeba',
      license: 'CC BY 2.0 FR',
      links: [{ lemmaId: 20, tokenIndex: 2, form: 'mesta', tag: 's2', ord: 0 }],
    });
    expect(row.verified).toBe(false);
  });

  it('parses a pattern keyed by form tags', () => {
    expect(
      PatternRowSchema.safeParse({
        id: 'mesto',
        labelSk: 'mesto',
        pos: 'noun',
        gender: 'n',
        modelLemmaId: 20,
        endings: { s1: 'o', s2: 'a', p2: '' },
      }).success,
    ).toBe(true);
    expect(
      PatternRowSchema.safeParse({
        id: 'mesto',
        labelSk: 'mesto',
        pos: 'noun',
        endings: { x: 'o' },
      }).success,
    ).toBe(false);
  });

  it('rejects a lesson step whose kind differs from its content', () => {
    const lesson = {
      id: 'acc-sg',
      ord: 1,
      titleEn: 'Accusative singular',
      titleSk: 'Akuzatív jednotného čísla',
      case: 'acc',
      number: 'sg',
      focus: { buckets: [{ case: 'acc', number: 'sg', gender: 'f', weight: 1 }], triggerIds: [] },
      summaryMd: 'The direct object.',
      steps: [
        { ord: 0, kind: 'triggers', content: { kind: 'triggers', triggerIds: ['prep-pre'] } },
      ],
    };
    const ok = LessonRowSchema.parse(lesson);
    expect(ok.course).toBe('declension');
    expect(ok.prerequisites).toEqual([]);
    const bad = { ...lesson, steps: [{ ...lesson.steps[0], kind: 'explain' }] };
    expect(LessonRowSchema.safeParse(bad).success).toBe(false);
  });

  it('parses an exercise', () => {
    const row = ExerciseRowSchema.parse({
      id: 'ex-7b21c0d4e9',
      kind: 'cloze',
      sentenceSk: 'Idem do mesta.',
      sentenceEn: 'I am going to town.',
      target: { start: 8, end: 13, lemmaIds: [20], cue: 'mesto', answers: ['mesta'] },
      case: 'gen',
      number: 'sg',
      gender: 'n',
      pattern: 'mesto',
      triggerId: 'prep-do',
      lessonId: 'gen-sg',
      difficulty: 0.2,
      source: 'authored',
    });
    expect(row.flags).toEqual({});
  });

  it('parses a manifest', () => {
    expect(
      ManifestSchema.safeParse({
        version: '2026-12-01.1',
        builtAt: '2026-12-01T06:00:00.000Z',
        sources: [{ name: 'mini', url: '', checksum: 'sha256:00', license: 'CC0' }],
        counts: { lemmas: 72 },
      }).success,
    ).toBe(true);
    expect(
      ManifestSchema.safeParse({ version: 'v1', builtAt: 'x', sources: [], counts: {} }).success,
    ).toBe(false);
  });
});
